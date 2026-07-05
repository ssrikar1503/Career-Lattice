"""
Ontology Matcher — Step 3 of the pipeline.

For each extracted_job:
1. Score against all canonical_roles using skill overlap + title similarity
2. Take top-3 candidates
3. Ask Claude Sonnet to make the final judgment: match / new-role / noise
4. Assign confidence score 0–1
5. Route: ≥0.85 → auto-approve | 0.50–0.84 → pending (human review) | <0.50 → rejected

We use skill overlap scoring instead of pgvector embeddings in the prototype
to avoid a third API dependency. The embedding column in the DB schema is
reserved for Phase 3 production upgrade (switch to pgvector + OpenAI embeddings
for better cross-industry matching at scale).
"""

import json
import re
import time
import os
import logging
from anthropic import Anthropic, RateLimitError as AnthropicRateLimit
from supabase import Client

import provider_state

log = logging.getLogger(__name__)

# Free-tier Gemini pacing — keep matcher under 15 RPM when Claude is absent.
GEMINI_PACE_SECONDS = 3.0

SENIORITY_RANK = {"entry": 0, "mid": 1, "senior": 2, "lead": 3}

MATCH_PROMPT = """You are an expert workforce taxonomist. Decide whether a scraped job posting matches a canonical career role.

CANONICAL ROLE:
Title: {role_title}
Cluster: {role_cluster}
Seniority: {role_seniority}
Skills: {role_skills}

SCRAPED JOB:
Normalized title: {job_title}
Seniority: {job_seniority}
Description excerpt: {job_description}

Rules:
- "match" = this job is clearly an instance of the canonical role (same function, similar level)
- "new_role" = this job represents a real role that doesn't exist in our taxonomy
- "noise" = not relevant to the industry, a stretch match, or too ambiguous to classify

Respond with ONLY a JSON object, no explanation:
{{"verdict": "match"|"new_role"|"noise", "confidence": 0.0-1.0, "reason": "one sentence"}}"""


def description_skill_score(description: str, role_skills: list[str]) -> float:
    """
    Fraction of the canonical role's top skills that literally appear in the
    job description. Substitute for the old per-job skills array, which is no
    longer extracted. Cheap substring check (no tokenization) — good enough
    signal at scale.
    """
    if not description or not role_skills:
        return 0.0
    text = description.lower()
    role_terms = [s.lower().strip() for s in role_skills[:8] if s]
    if not role_terms:
        return 0.0
    hits = sum(1 for term in role_terms if term and term in text)
    return hits / len(role_terms)


def title_similarity(job_title: str, role_title: str) -> float:
    """Word overlap between titles, ignoring common filler tokens."""
    stop = {"the", "a", "of", "and", "for", "in", "to", "i", "ii", "iii", "1", "2", "3"}
    j_words = {w for w in re.findall(r"\w+", job_title.lower()) if w not in stop}
    r_words = {w for w in re.findall(r"\w+", role_title.lower()) if w not in stop}
    if not j_words or not r_words:
        return 0.0
    return len(j_words & r_words) / max(len(j_words), len(r_words))


def seniority_score(job_seniority: str, role_seniority: str) -> float:
    """Graded match — adjacent tiers are still good signal."""
    js = SENIORITY_RANK.get(job_seniority, 1)
    rs = SENIORITY_RANK.get(role_seniority, 1)
    diff = abs(js - rs)
    if diff == 0: return 1.0
    if diff == 1: return 0.7
    if diff == 2: return 0.4
    return 0.2


def rank_candidates(extracted_job: dict, canonical_roles: list[dict]) -> list[dict]:
    """
    Score all canonical roles and return top-3.

    Weights:
    - Title is the strongest signal (50%)
    - Description-vs-role-skills substring hit-rate (30%)
    - Seniority alignment, graded — adjacent tiers still count (20%)
    """
    job_title       = extracted_job.get("normalized_title", "")
    job_seniority   = extracted_job.get("seniority", "mid")
    job_description = ((extracted_job.get("raw_jobs") or {}).get("raw_description") or "")

    scored = []
    for role in canonical_roles:
        title_score = title_similarity(job_title, role.get("title", ""))
        skill_score = description_skill_score(job_description, role.get("skills", []))
        sen_score   = seniority_score(job_seniority, role.get("seniority", "mid"))
        combined    = title_score * 0.5 + skill_score * 0.3 + sen_score * 0.2
        scored.append({"role": role, "score": combined})

    scored.sort(key=lambda x: x["score"], reverse=True)
    return scored[:3]


def _parse_judgment(text: str) -> dict | None:
    text = text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1].rsplit("```", 1)[0].strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return None


def _judge_with_claude(prompt: str, client: Anthropic) -> dict | None:
    message = client.messages.create(
        model="claude-sonnet-4-6",  # Sonnet for accuracy on judgment calls
        max_tokens=200,
        messages=[{"role": "user", "content": prompt}],
    )
    return _parse_judgment(message.content[0].text)


def _is_rate_limit_error(err: Exception) -> bool:
    s = str(err).lower()
    return "429" in s or "rate" in s or "quota" in s or "resourceexhausted" in s


def _judge_with_gemini(prompt: str, max_retries: int = 3) -> dict | None:
    """Gemini judgment — skipped if circuit breaker has flipped Gemini dead.

    Model pinned to gemini-2.0-flash (1500/day free) — gemini-2.5-flash dropped
    to 20/day on the free tier in June 2026 which makes it unusable for a
    real backlog.

    Phase 4 — migrated from deprecated `google.generativeai` to `google.genai`."""
    if not provider_state.state().can_try("gemini"):
        return None
    try:
        from google import genai
        client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
    except ImportError:
        return None

    for attempt in range(max_retries):
        try:
            response = client.models.generate_content(
                model="gemini-2.0-flash",
                contents=prompt,
            )
            text = getattr(response, "text", "") or ""
            parsed = _parse_judgment(text)
            if parsed is None and attempt < max_retries - 1:
                log.warning(
                    f"Gemini judgment unparseable (attempt {attempt+1}): "
                    f"{text[:200]!r}"
                )
                time.sleep(2)
                continue
            return parsed
        except Exception as e:
            kind = provider_state.classify_rate_limit(e)
            if kind == "daily":
                provider_state.state().mark_dead("gemini", str(e)[:200])
                return None
            if kind == "per_minute" and attempt < max_retries - 1:
                wait = 5 * (2 ** attempt)
                log.warning(f"Gemini per-minute rate limit (attempt {attempt+1}), waiting {wait}s…")
                time.sleep(wait)
                continue
            log.warning(f"Gemini judgment failed (attempt {attempt+1}): {str(e)[:200]}")
            return None
    return None


def _judge_with_groq(prompt: str, max_retries: int = 3) -> dict | None:
    """Groq Llama 3.3 70B judgment. Skipped if circuit breaker flipped Groq dead."""
    if not provider_state.state().can_try("groq"):
        return None
    try:
        from groq import Groq
        client = Groq(api_key=os.environ["GROQ_API_KEY"])
    except ImportError:
        return None

    for attempt in range(max_retries):
        try:
            response = client.chat.completions.create(
                model="llama-3.3-70b-versatile",
                max_tokens=200,
                messages=[{"role": "user", "content": prompt}],
            )
            text = response.choices[0].message.content if response.choices else ""
            parsed = _parse_judgment(text)
            if parsed is None and attempt < max_retries - 1:
                log.warning(
                    f"Groq judgment unparseable (attempt {attempt+1}): "
                    f"{(text or '')[:200]!r}"
                )
                time.sleep(2)
                continue
            return parsed
        except Exception as e:
            kind = provider_state.classify_rate_limit(e)
            if kind == "daily":
                provider_state.state().mark_dead("groq", str(e)[:200])
                return None
            if kind == "per_minute" and attempt < max_retries - 1:
                wait = 5 * (2 ** attempt)
                log.warning(f"Groq per-minute rate limit (attempt {attempt+1}), waiting {wait}s…")
                time.sleep(wait)
                continue
            log.warning(f"Groq judgment failed (attempt {attempt+1}): {str(e)[:200]}")
            return None
    return None


def claude_judge(
    extracted_job: dict,
    candidate_role: dict,
    client: Anthropic | None,
    max_retries: int = 3,
) -> dict | None:
    """
    Judge whether a job matches a canonical role. Provider order:
      Claude (if client passed) → Groq (if GROQ_API_KEY) → Gemini (if GEMINI_API_KEY).
    Returns None if everything fails — caller treats as low-confidence rejection.
    """
    # Per-job skills are no longer extracted — feed the matcher a short raw
    # description excerpt instead so it still has semantic signal beyond the
    # title. 600 chars keeps token cost low; the description's first paragraph
    # is usually a role summary which is what we want.
    raw_description = ((extracted_job.get("raw_jobs") or {}).get("raw_description") or "")
    description_excerpt = raw_description.strip()[:600]

    prompt = MATCH_PROMPT.format(
        role_title=candidate_role.get("title", ""),
        role_cluster=candidate_role.get("cluster", ""),
        role_seniority=candidate_role.get("seniority", ""),
        role_skills=", ".join(candidate_role.get("skills", [])[:8]),
        job_title=extracted_job.get("normalized_title", ""),
        job_seniority=extracted_job.get("seniority", ""),
        job_description=description_excerpt or "(no description available)",
    )

    # 1. Claude first if configured (most accurate, paid)
    if client is not None:
        for attempt in range(max_retries):
            try:
                result = _judge_with_claude(prompt, client)
                if result:
                    return result
            except AnthropicRateLimit:
                wait = 2 ** attempt
                log.warning(f"Claude rate limit on attempt {attempt+1}, waiting {wait}s…")
                time.sleep(wait)
            except Exception as e:
                log.warning(f"Claude judgment error (attempt {attempt+1}): {e}")
                if attempt == max_retries - 1:
                    break
                time.sleep(2)
        log.info("Claude exhausted — falling back to Groq")

    # 2. Groq — best free-tier throughput. Circuit-breaker aware.
    if provider_state.state().can_try("groq"):
        result = _judge_with_groq(prompt)
        if result:
            return result

    # 3. Gemini — last resort. Circuit-breaker aware.
    if provider_state.state().can_try("gemini"):
        return _judge_with_gemini(prompt)

    return None


def route_confidence(confidence: float) -> str:
    """
    Confidence → moderation bucket.
    Lower thresholds than the initial design — the original 0.85/0.50 gates
    produced ~100% rejections on the first real-world run because most
    scraped roles are not perfect-fit matches. 0.80/0.35 keeps the auto-approve
    bar high but gives the human admin queue more borderline cases to review,
    which is what the queue is for.
    """
    if confidence >= 0.80:
        return "approved"
    if confidence >= 0.35:
        return "pending"
    return "rejected"


def run_matcher(
    supabase: Client,
    anthropic: Anthropic | None,
    industry_slug: str,
    batch_size: int = 500,
) -> dict:
    """Match unmatched extracted_jobs against canonical_roles for one industry."""

    # Load canonical roles for this industry
    industry_result = (
        supabase.table("industries")
        .select("id")
        .eq("slug", industry_slug)
        .single()
        .execute()
    )
    if not industry_result.data:
        log.error(f"Industry {industry_slug!r} not found in DB — has the schema been seeded?")
        return {"matched": 0, "pending": 0, "rejected": 0}

    industry_id = industry_result.data["id"]

    roles_result = (
        supabase.table("canonical_roles")
        .select("id, title, cluster, seniority, skills")
        .eq("industry_id", industry_id)
        .execute()
    )
    canonical_roles = roles_result.data or []
    if not canonical_roles:
        log.warning(f"No canonical roles found for {industry_slug!r}.")
        return {"matched": 0, "pending": 0, "rejected": 0}

    # Page through role_matches.extracted_job_id — Supabase silently caps a
    # single .limit() call at 1000 rows. Without pagination this set would
    # cap out at 1000 and we'd start re-judging old matches once role_matches
    # crosses that count.
    PAGE = 1000
    already_matched: set[str] = set()
    offset = 0
    while True:
        result = (
            supabase.table("role_matches")
            .select("extracted_job_id")
            .range(offset, offset + PAGE - 1)
            .execute()
        )
        rows = result.data or []
        for r in rows:
            already_matched.add(r["extracted_job_id"])
        if len(rows) < PAGE:
            break
        offset += PAGE

    # Phase 3.6 — filter extracted_jobs by industry. Without this filter the
    # matcher's per-industry loop ran into a "first-industry-wins" bug: AM
    # would consume every job in the queue (rejecting most as non-AM), leaving
    # Semi and Space matchers with zero jobs to judge.
    # Pagination here works around the same 1000-row PostgREST cap that bit
    # the extractor. Stops paginating once we have batch_size unmatched jobs.
    all_extracted: list[dict] = []
    offset = 0
    while len(all_extracted) < batch_size:
        result = (
            supabase.table("extracted_jobs")
            .select("id, normalized_title, seniority, location, country, industry, raw_jobs(company, raw_description)")
            .eq("industry", industry_slug)
            .range(offset, offset + PAGE - 1)
            .execute()
        )
        rows = result.data or []
        for r in rows:
            if r["id"] not in already_matched:
                all_extracted.append(r)
                if len(all_extracted) >= batch_size:
                    break
        if len(rows) < PAGE:
            break
        offset += PAGE

    log.info(f"Matching {len(all_extracted)} jobs against {len(canonical_roles)} canonical roles for {industry_slug}…")

    stats = {"matched": 0, "pending": 0, "rejected": 0}
    has_claude = anthropic is not None
    has_groq   = bool(os.environ.get("GROQ_API_KEY"))
    needs_pace = not has_claude and not has_groq

    for i, job in enumerate(all_extracted):
        # Phase 3.9 — bail out cleanly when both free providers are out for the day.
        if anthropic is None and provider_state.state().all_free_providers_dead():
            log.warning(
                f"All free AI providers exhausted for the day. "
                f"Stopping matcher early — processed {sum(stats.values())}/{i} for {industry_slug}. "
                f"State: {provider_state.state().summary()}"
            )
            break

        # Pace runs only when our primary path is the rate-limited Gemini free tier.
        if needs_pace and i > 0:
            time.sleep(GEMINI_PACE_SECONDS)

        top3 = rank_candidates(job, canonical_roles)
        if not top3 or top3[0]["score"] < 0.05:
            # Almost no signal at all — reject pre-AI without spending API calls.
            # Threshold lowered from 0.10 to 0.05 so more borderline candidates
            # get a real AI judgment instead of being thrown away.
            supabase.table("role_matches").insert({
                "extracted_job_id":  job["id"],
                "canonical_role_id": top3[0]["role"]["id"] if top3 else canonical_roles[0]["id"],
                "confidence":        0.0,
                "status":            "rejected",
            }).execute()
            stats["rejected"] += 1
            continue

        best = top3[0]["role"]
        judgment = claude_judge(job, best, anthropic)
        if not judgment or judgment.get("verdict") == "noise":
            confidence = 0.1
        elif judgment.get("verdict") == "new_role":
            # "new_role" means the AI thinks this is a real job that doesn't
            # fit any existing canonical role. The whole point of this verdict
            # is to surface it to a human reviewer — so it must land in the
            # pending bucket (>=0.35), not auto-rejected.
            confidence = 0.5
        else:
            confidence = float(judgment.get("confidence", 0.5))

        status = route_confidence(confidence)
        stats[status if status == "rejected" else ("matched" if status == "approved" else "pending")] += 1

        supabase.table("role_matches").insert({
            "extracted_job_id":  job["id"],
            "canonical_role_id": best["id"],
            "confidence":        round(confidence, 2),
            "status":            status,
        }).execute()

        # Auto-approved: update job count + hiring company on the canonical role.
        # Phase 3 — canonical_roles.open_jobs_count and hiring_companies are
        # the cached US-only view used by the default UI. Worldwide counts are
        # computed live from role_matches at API time.
        if status == "approved" and (job.get("country") or "").upper() == "US":
            supabase.rpc("increment_job_count", {"role_id": best["id"]}).execute()
            # Phase 2.3 — doc Step 5 requires "company list" on each canonical role
            company = ((job.get("raw_jobs") or {}).get("company") or "").strip()
            if company:
                _add_hiring_company(supabase, best["id"], company)

    log.info(f"  {industry_slug}: {stats}")
    return stats


def _add_hiring_company(supabase: Client, role_id: str, company: str) -> None:
    """Append `company` to canonical_roles.hiring_companies if not already present.

    Read-then-write keeps the array deduplicated. Postgres has no native
    array_distinct, and the matcher is single-threaded per industry so there's
    no race here. If concurrency is added later, switch to a SQL RPC that does
    DISTINCT-style append atomically.
    """
    try:
        row = (
            supabase.table("canonical_roles")
            .select("hiring_companies")
            .eq("id", role_id)
            .single()
            .execute()
        )
        current = (row.data or {}).get("hiring_companies") or []
        if company in current:
            return
        updated = current + [company]
        supabase.table("canonical_roles").update(
            {"hiring_companies": updated}
        ).eq("id", role_id).execute()
    except Exception as e:
        # Don't crash the pipeline if this one update fails — the job count
        # already incremented and the match is still recorded.
        log.warning(f"Could not update hiring_companies for role {role_id}: {e}")
