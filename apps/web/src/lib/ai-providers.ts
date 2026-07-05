/**
 * Multi-provider AI abstraction with automatic fallback and circuit breaker.
 *
 * PROVIDER ORDER: Claude → Gemini → OpenAI
 *   Each provider is tried in order. If one hits a rate limit, is overloaded,
 *   or has no API key configured, the next one is tried automatically.
 *   The user never sees an error unless ALL configured providers fail.
 *
 * CIRCUIT BREAKER (system design pattern):
 *   A circuit breaker prevents the system from repeatedly calling a service
 *   that is clearly failing. Three states:
 *
 *   CLOSED  ─── normal, requests flow through
 *       │ (3 failures in a row)
 *       ▼
 *   OPEN    ─── provider is skipped entirely
 *       │ (after 10 minutes)
 *       ▼
 *   HALF-OPEN ─── one trial request is allowed
 *       │ (success → CLOSED, failure → OPEN again)
 *
 *   Why: avoids wasting 5 seconds waiting for a provider you know is down,
 *   and avoids hammering a struggling API making it worse.
 *
 * ADDING A NEW PROVIDER:
 *   1. Implement the AIProvider interface below
 *   2. Add to PROVIDER_ORDER array at the bottom of this file
 *   3. Add the API key to .env.example
 */

export interface AIMessage {
  role:    'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  system:    string;
  messages:  AIMessage[];
  maxTokens?: number;
}

// ── Circuit Breaker ────────────────────────────────────────────────────────────
const FAILURE_THRESHOLD = 3;   // consecutive failures before opening
const RESET_TIMEOUT_MS  = 10 * 60 * 1000; // 10 minutes before half-open

class CircuitBreaker {
  private failures   = 0;
  private lastFail   = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';

  canAttempt(): boolean {
    if (this.state === 'closed')     return true;
    if (this.state === 'half-open')  return true; // one trial allowed
    // OPEN state — check if reset timeout has passed
    if (Date.now() - this.lastFail > RESET_TIMEOUT_MS) {
      this.state = 'half-open';
      return true;
    }
    return false;
  }

  onSuccess() {
    this.failures = 0;
    this.state    = 'closed';
  }

  onFailure() {
    this.failures++;
    this.lastFail = Date.now();
    if (this.failures >= FAILURE_THRESHOLD) {
      this.state = 'open';
    }
  }

  getState() { return this.state; }
}

// ── Shared circuit breakers (persist for process lifetime) ────────────────────
const breakers = {
  claude: new CircuitBreaker(),
  gemini: new CircuitBreaker(),
  openai: new CircuitBreaker(),
} as const;

// ── Error classification ───────────────────────────────────────────────────────
function isRateLimitError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as Record<string, unknown>;
  const msg = String(e.message ?? '').toLowerCase();
  return (
    e.status === 429 ||
    msg.includes('rate limit') ||
    msg.includes('quota exceeded') ||
    msg.includes('resource_exhausted') ||
    msg.includes('overloaded') ||
    msg.includes('too many requests')
  );
}

function isTransientError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as Record<string, unknown>;
  return (
    e.status === 503 ||
    e.status === 502 ||
    e.status === 529 || // Anthropic overloaded
    String(e.message ?? '').toLowerCase().includes('overloaded')
  );
}

// ── Provider: Claude ──────────────────────────────────────────────────────────
async function* streamClaude(options: ChatOptions): AsyncGenerator<string> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

  const stream = client.messages.stream({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: options.maxTokens ?? 1024,
    system:     options.system,
    messages:   options.messages,
  });

  for await (const chunk of stream) {
    if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
      yield chunk.delta.text;
    }
  }
}

// ── Provider: Gemini ──────────────────────────────────────────────────────────
async function* streamGemini(options: ChatOptions): AsyncGenerator<string> {
  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

  const model = genAI.getGenerativeModel({
    model:             'gemini-2.5-flash', // free tier available
    systemInstruction: options.system,
  });

  // Gemini uses different role names and splits history from current message
  const history = options.messages.slice(0, -1).map(m => ({
    role:  m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));
  const lastMsg = options.messages[options.messages.length - 1];

  const chat   = model.startChat({ history });
  const result = await chat.sendMessageStream(lastMsg?.content ?? '');

  for await (const chunk of result.stream) {
    const text = chunk.text();
    if (text) yield text;
  }
}

// ── Provider: OpenAI ──────────────────────────────────────────────────────────
async function* streamOpenAI(options: ChatOptions): AsyncGenerator<string> {
  const { default: OpenAI } = await import('openai');
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

  const stream = await client.chat.completions.create({
    model:      'gpt-4o-mini', // cheapest capable model
    max_tokens: options.maxTokens ?? 1024,
    messages: [
      { role: 'system', content: options.system },
      ...options.messages,
    ],
    stream: true,
  });

  for await (const chunk of stream) {
    const text = chunk.choices[0]?.delta?.content ?? '';
    if (text) yield text;
  }
}

// ── Provider registry ─────────────────────────────────────────────────────────
type ProviderName = 'claude' | 'gemini' | 'openai';

const PROVIDERS: Array<{
  name:          ProviderName;
  envKey:        string;
  stream:        (opts: ChatOptions) => AsyncGenerator<string>;
  breaker:       CircuitBreaker;
}> = [
  {
    name:    'claude',
    envKey:  'ANTHROPIC_API_KEY',
    stream:  streamClaude,
    breaker: breakers.claude,
  },
  {
    name:    'gemini',
    envKey:  'GEMINI_API_KEY',
    stream:  streamGemini,
    breaker: breakers.gemini,
  },
  {
    name:    'openai',
    envKey:  'OPENAI_API_KEY',
    stream:  streamOpenAI,
    breaker: breakers.openai,
  },
];

// ── Main export: stream with automatic fallback ────────────────────────────────
export interface StreamResult {
  stream:       AsyncGenerator<string>;
  providerUsed: string;
}

export async function streamWithFallback(options: ChatOptions): Promise<StreamResult> {
  const available = PROVIDERS.filter(p => !!process.env[p.envKey]);

  if (available.length === 0) {
    throw new Error(
      'No AI providers configured. Add at least one of: ' +
      'ANTHROPIC_API_KEY, GEMINI_API_KEY, OPENAI_API_KEY to your .env.local file.'
    );
  }

  // Try each configured provider in order.
  // KEY INSIGHT: provider.stream() returns a generator instantly without
  // making any API calls. The actual API call (and any rate-limit error)
  // happens on the first `await gen.next()`. So we MUST prime the generator
  // here — pull the first chunk — to know whether the provider really worked.
  // If priming fails, we fall over to the next provider. Once we have a
  // first chunk, we're committed to this provider for the rest of the stream.
  const lastErrors: string[] = [];

  for (const provider of available) {
    if (!provider.breaker.canAttempt()) {
      // Circuit is OPEN — skip this provider entirely
      console.warn(`[ai-providers] ${provider.name} circuit OPEN — skipping`);
      lastErrors.push(`${provider.name}: circuit open`);
      continue;
    }

    let gen: AsyncGenerator<string>;
    let firstChunk: IteratorResult<string>;

    try {
      gen = provider.stream(options);
      // Prime: pull the first chunk so any API error surfaces NOW.
      firstChunk = await gen.next();
    } catch (err) {
      const shouldFallback = isRateLimitError(err) || isTransientError(err);
      provider.breaker.onFailure();
      const msg = (err as Error)?.message ?? String(err);
      lastErrors.push(`${provider.name}: ${msg}`);
      console.warn(
        `[ai-providers] ${provider.name} priming failed ` +
        `(breaker: ${provider.breaker.getState()}, fallback: ${shouldFallback}): ${msg}`
      );
      if (shouldFallback) continue; // try next provider
      throw err;                    // non-retriable — bubble up
    }

    // Provider worked — record success and return a wrapped stream that
    // replays the buffered first chunk, then continues with the rest.
    provider.breaker.onSuccess();
    console.log(`[ai-providers] using ${provider.name}`);
    return {
      stream:       replayThenContinue(firstChunk, gen, provider.breaker, provider.name),
      providerUsed: provider.name,
    };
  }

  throw new Error(
    `All AI providers failed. ${lastErrors.join(' · ') || 'Try again in a few minutes.'}`
  );
}

// Replays the primed first chunk (if any) and then yields the rest of the
// stream. Mid-stream errors are still caught here — at that point we've
// already started sending to the client and can't switch providers, so the
// stream just ends gracefully.
async function* replayThenContinue(
  firstChunk: IteratorResult<string>,
  gen:        AsyncGenerator<string>,
  breaker:    CircuitBreaker,
  name:       string,
): AsyncGenerator<string> {
  if (!firstChunk.done && firstChunk.value) {
    yield firstChunk.value;
  }
  try {
    for await (const chunk of gen) {
      yield chunk;
    }
  } catch (err) {
    breaker.onFailure();
    console.warn(`[ai-providers] ${name} mid-stream error:`, (err as Error)?.message);
    // Don't rethrow — the stream is already partially delivered; just end it
  }
}

// ── Utility: get which providers are configured (for status page / health check)
export function getProviderStatus() {
  return PROVIDERS.map(p => ({
    name:        p.name,
    configured:  !!process.env[p.envKey],
    circuit:     p.breaker.getState(),
  }));
}
