/**
 * POST /api/agent/chat
 *
 * Streaming AI advisor endpoint.
 *
 * System design highlights:
 *   1. Rate limiting   — sliding window, per-IP, hourly + daily limits
 *   2. Multi-provider  — Claude → Gemini → OpenAI, automatic fallback
 *   3. Circuit breaker — failing providers are bypassed for 10 min
 *   4. Request timeout — hard 30s limit, no hanging connections
 *   5. Graceful error  — every failure returns a readable message, not a crash
 */

import type { IndustryData } from '@/lib/types';
import { streamWithFallback } from '@/lib/ai-providers';
import { checkRateLimit, LIMITS, getClientIp } from '@/lib/rate-limit';

import amData    from '@/data/additive-manufacturing.json';
import semiData  from '@/data/semiconductors.json';
import spaceData from '@/data/space.json';

const INDUSTRY_MAP: Record<string, IndustryData> = {
  'additive-manufacturing': amData    as IndustryData,
  'semiconductors':         semiData  as IndustryData,
  'space':                  spaceData as IndustryData,
};

// ── Taxonomy context builder ───────────────────────────────────────────────────
function buildContext(data: IndustryData): string {
  const roles = data.roles.map(r =>
    `[${r.id}] ${r.title} | ${r.cluster} | ${r.seniority} | ` +
    `$${Math.round(r.salary_min / 1000)}k–$${Math.round(r.salary_max / 1000)}k | ` +
    `${r.degree_required} | Skills: ${r.skills.slice(0, 5).map(s => s.name).join(', ')}`
  ).join('\n');

  const pathways = data.pathways.map(p =>
    `${p.name}: ${p.role_ids.join(' → ')}`
  ).join('\n');

  return `=== ${data.industry.name} Roles ===\n${roles}\n\n=== Career Pathways ===\n${pathways}`;
}

function buildSystemPrompt(context: string, industryName: string): string {
  return `You are dolphIQ — an AI career guide for the ${industryName} industry. Your name combines "dolphin" (one of the most intelligent species on Earth and a navigator of unfamiliar waters) with "IQ" (intelligence). You help students, workers, and career changers navigate roles, required skills, salary expectations, and career pathways.

IDENTITY:
- Refer to yourself as dolphIQ if asked who or what you are.
- If a user greets you or asks a meta-question ("who are you?"), give a brief introduction: you are dolphIQ, an AI guide for the ${industryName} career lattice on this site.
- Tone: warm, professional, plainspoken. Encourage exploration. Never condescending.

TAXONOMY:
${context}

RULES:
1. Cite every specific role using its ID in brackets — e.g. [am-r-21] — the UI turns these into clickable links.
2. Always include salary ranges and education requirements when discussing specific roles.
3. Keep answers to 3–5 short paragraphs maximum.
4. End with 2–3 concrete "Next steps" the user can take.
5. Only cite IDs that appear in the taxonomy above. Never invent IDs.
6. If asked about something outside this industry, say so and redirect to one of the three industries this site covers (Additive Manufacturing, Semiconductors, Space Industry).
7. You are not a recruiter and don't have live job opening details — direct the user to the role detail pages for that. You are not a financial advisor — salary ranges are U.S. market estimates, not guarantees.`;
}

// ── Suggested prompts per industry ────────────────────────────────────────────
const SUGGESTED: Record<string, string[]> = {
  'additive-manufacturing': [
    "What's the best path from machine operator to process engineer?",
    "Which AM roles pay over $100k without requiring a degree?",
    "How do I break into additive manufacturing from aerospace?",
    "What certifications matter most for an AM technician?",
  ],
  'semiconductors': [
    "What's the difference between a fab operator and process engineer?",
    "How do I get into chip design without an EE degree?",
    "Which semiconductor roles are growing fastest after the CHIPS Act?",
    "What's the path from wafer fab technician to engineering manager?",
  ],
  'space': [
    "How do I become a spacecraft systems engineer?",
    "Which space roles are accessible without an aerospace degree?",
    "What's the career path from AIT technician to mission director?",
    "Which propulsion roles pay over $150k?",
  ],
};

// ── GET: suggested prompts ────────────────────────────────────────────────────
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const industry = searchParams.get('industry') ?? '';
  return Response.json({ suggested: SUGGESTED[industry] ?? [] });
}

// ── POST: streaming chat ──────────────────────────────────────────────────────
export async function POST(request: Request) {
  const ip = getClientIp(request);

  // ── 1. Rate limiting ────────────────────────────────────────────────────────
  const hourly = checkRateLimit(`chat:hourly:${ip}`, LIMITS.chat_hourly);
  if (!hourly.allowed) {
    return Response.json(
      {
        error:
          `You've reached the hourly limit (${LIMITS.chat_hourly.maxRequests} messages/hour). ` +
          `Try again in ${Math.ceil(hourly.resetInMs / 60000)} minutes.`,
        retryAfter: hourly.retryAfter,
      },
      {
        status: 429,
        headers: {
          'Retry-After':      String(hourly.retryAfter),
          'X-RateLimit-Limit':     String(LIMITS.chat_hourly.maxRequests),
          'X-RateLimit-Remaining': '0',
        },
      },
    );
  }

  const daily = checkRateLimit(`chat:daily:${ip}`, LIMITS.chat_daily);
  if (!daily.allowed) {
    return Response.json(
      {
        error:
          `You've reached the daily limit (${LIMITS.chat_daily.maxRequests} messages/day). ` +
          `Try again tomorrow.`,
        retryAfter: daily.retryAfter,
      },
      { status: 429, headers: { 'Retry-After': String(daily.retryAfter) } },
    );
  }

  // ── 2. Parse and validate request ──────────────────────────────────────────
  let body: { message: string; industry: string; history: Array<{ role: 'user' | 'assistant'; content: string }> };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { message, industry, history = [] } = body;

  if (!message?.trim()) {
    return Response.json({ error: 'Message cannot be empty' }, { status: 400 });
  }
  if (!industry || !INDUSTRY_MAP[industry]) {
    return Response.json({ error: 'Unknown industry' }, { status: 400 });
  }

  // ── 3. Build context and messages ──────────────────────────────────────────
  const data    = INDUSTRY_MAP[industry];
  const context = buildContext(data);
  const system  = buildSystemPrompt(context, data.industry.name);

  // Keep last 8 turns to control token cost
  const messages = [
    ...history.slice(-8),
    { role: 'user' as const, content: message.trim() },
  ];

  // ── 4. Stream with multi-provider fallback ──────────────────────────────────
  let providerResult: Awaited<ReturnType<typeof streamWithFallback>>;
  try {
    providerResult = await streamWithFallback({ system, messages, maxTokens: 1024 });
  } catch (err: unknown) {
    const msg = (err as Error)?.message ?? 'All AI providers are currently unavailable.';
    return Response.json({ error: msg }, { status: 503 });
  }

  // ── 5. Return SSE stream (with 30s hard timeout) ────────────────────────────
  const { stream, providerUsed } = providerResult;
  const TIMEOUT_MS = 30_000;

  const readable = new ReadableStream({
    async start(controller) {
      const enc  = new TextEncoder();
      const send = (payload: object) =>
        controller.enqueue(enc.encode(`data: ${JSON.stringify(payload)}\n\n`));

      // Announce which provider is being used (useful for debugging)
      send({ provider: providerUsed });

      const timer = setTimeout(() => {
        send({ error: 'Response timed out. Please try a shorter question.' });
        controller.close();
      }, TIMEOUT_MS);

      try {
        for await (const chunk of stream) {
          send({ text: chunk });
        }
        send({ done: true });
      } catch (err: unknown) {
        send({ error: (err as Error)?.message ?? 'Stream error' });
      } finally {
        clearTimeout(timer);
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      'Content-Type':          'text/event-stream',
      'Cache-Control':         'no-cache',
      'Connection':            'keep-alive',
      'X-RateLimit-Remaining': String(hourly.remaining),
      'X-Provider':            providerResult.providerUsed,
    },
  });
}
