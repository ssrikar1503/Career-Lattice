"""
Provider state — per-run circuit breaker for AI providers.

WHAT THIS SOLVES:
  Before Phase 3.9 the pipeline would retry Groq and Gemini per-job, even after
  one of them had clearly hit its daily quota. With 50 seconds of wasted retry
  + backoff per dead-provider call × hundreds of jobs, a single GitHub Actions
  run would burn 5 hours producing nothing.

  The circuit breaker tracks daily quota exhaustion ONCE per run. After a
  provider has hit a "per day" / "TPD" / "RPD" error, the rest of the run
  skips that provider entirely — no retries, no backoff, no waiting.

  When all configured free providers are exhausted, the orchestrator can
  bail out cleanly with a summary instead of running to the GH Actions
  timeout.

WHY MODULE-LEVEL SINGLETON:
  The pipeline runs as one Python process per cron tick. State is conceptually
  global for that process. Module-level avoids threading a `state` parameter
  through 6 layers of function calls in extractor.py + matcher.py.

USAGE:
    from provider_state import state, classify_rate_limit

    if not state().can_try('groq'):
        return None
    try:
        response = groq_client.chat.completions.create(...)
    except Exception as e:
        kind = classify_rate_limit(e)
        if kind == 'daily':
            state().mark_dead('groq', str(e)[:200])
            return None       # daily is dead — don't retry
        elif kind == 'per_minute':
            time.sleep(backoff)
            continue           # transient — keep retrying
"""

import os
import logging
from datetime import datetime, timezone

log = logging.getLogger(__name__)


class _State:
    def __init__(self) -> None:
        self.groq_daily_dead:   bool = False
        self.gemini_daily_dead: bool = False
        self.groq_dead_at:      datetime | None = None
        self.gemini_dead_at:    datetime | None = None

    def mark_dead(self, provider: str, reason: str = "") -> None:
        """
        Mark provider as exhausted for the rest of the run. Idempotent — calling
        it twice for the same provider is a no-op.
        """
        if provider == "groq" and not self.groq_daily_dead:
            self.groq_daily_dead = True
            self.groq_dead_at    = datetime.now(timezone.utc)
            log.warning(
                f"Groq daily quota exhausted at {self.groq_dead_at.isoformat()} — "
                f"skipping Groq for the rest of this run. Reason: {reason or 'n/a'}"
            )
        elif provider == "gemini" and not self.gemini_daily_dead:
            self.gemini_daily_dead = True
            self.gemini_dead_at    = datetime.now(timezone.utc)
            log.warning(
                f"Gemini daily quota exhausted at {self.gemini_dead_at.isoformat()} — "
                f"skipping Gemini for the rest of this run. Reason: {reason or 'n/a'}"
            )

    def can_try(self, provider: str) -> bool:
        """True if provider is configured AND not marked dead this run."""
        if provider == "groq":
            return bool(os.environ.get("GROQ_API_KEY")) and not self.groq_daily_dead
        if provider == "gemini":
            return bool(os.environ.get("GEMINI_API_KEY")) and not self.gemini_daily_dead
        return False

    def all_free_providers_dead(self) -> bool:
        """
        True when every configured free provider is exhausted for the day.
        Used by the orchestrator to bail out cleanly instead of running into
        the GitHub Actions timeout.

        Claude (Anthropic) is paid and doesn't share this daily-quota concept,
        so this check ignores Claude. If only Claude is configured, this is
        trivially False.
        """
        groq_configured   = bool(os.environ.get("GROQ_API_KEY"))
        gemini_configured = bool(os.environ.get("GEMINI_API_KEY"))

        if not (groq_configured or gemini_configured):
            return False  # nothing free configured — no daily wall to hit

        groq_alive   = groq_configured   and not self.groq_daily_dead
        gemini_alive = gemini_configured and not self.gemini_daily_dead
        return not (groq_alive or gemini_alive)

    def summary(self) -> str:
        """One-line status for logging at end of run."""
        bits = []
        if os.environ.get("GROQ_API_KEY"):
            bits.append(f"groq={'DEAD' if self.groq_daily_dead else 'alive'}")
        if os.environ.get("GEMINI_API_KEY"):
            bits.append(f"gemini={'DEAD' if self.gemini_daily_dead else 'alive'}")
        return "ProviderState[" + " ".join(bits) + "]" if bits else "ProviderState[no providers]"


_state_singleton = _State()


def state() -> _State:
    """Return the per-run provider state."""
    return _state_singleton


# ── Rate-limit classification ─────────────────────────────────────────────────

# Daily quota indicators across Groq + Gemini error messages.
# These come from real production error strings we've seen.
_DAILY_SIGNALS = (
    "per day",          # Groq's "tokens per day (TPD)"
    "tpd",              # Groq's shorthand
    "perday",           # Gemini's "PerDayPerProjectPerModel" quota_id
    "per_day",
    "tokens per day",
    "requests per day",
    "rpd",
)

_PER_MINUTE_SIGNALS = (
    "per minute",       # Groq's "tokens per minute (TPM)"
    "tpm",              # Groq's shorthand
    "rpm",              # Groq's "requests per minute"
    "perminute",        # Gemini's "PerMinutePerProjectPerModel" quota_id
    "per_minute",
    "tokens per minute",
    "requests per minute",
)

_GENERIC_RATE_LIMIT_SIGNALS = (
    "429",
    "rate limit",
    "rate_limit",
    "quota",
    "exceeded",
    "resource_exhausted",
    "too many requests",
)


def classify_rate_limit(err) -> str | None:
    """
    Classify a provider error into:
      'daily'      — daily quota exhausted, don't retry this run
      'per_minute' — transient burst, safe to back off and retry
      None         — not a rate-limit error at all

    Implementation: lowercase the error message and string-match against
    the patterns above. Real Groq + Gemini errors contain at least one of
    these signals; if not, we conservatively treat generic 429s as
    'per_minute' (the safer choice — wait briefly then try again).
    """
    if not err:
        return None
    msg = str(err).lower()
    if any(s in msg for s in _DAILY_SIGNALS):
        return "daily"
    if any(s in msg for s in _PER_MINUTE_SIGNALS):
        return "per_minute"
    if any(s in msg for s in _GENERIC_RATE_LIMIT_SIGNALS):
        return "per_minute"  # safer default
    return None
