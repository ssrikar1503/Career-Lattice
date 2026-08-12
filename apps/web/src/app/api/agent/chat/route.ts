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
import { getLiveOpeningsBlock } from '@/lib/live-openings';

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

  return `=== ${data.industry.name} (map: ${data.industry.slug}) ===\n${roles}` +
    (pathways ? `\n\n=== ${data.industry.name} Career Pathways ===\n${pathways}` : '');
}

function buildAllContext(): string {
  return Object.values(INDUSTRY_MAP).map(d => buildContext(d)).join('\n\n');
}

function buildSystemPrompt(context: string, industryName: string, selectedPath?: string, openingsBlock?: string): string {
  const pathSection = selectedPath
    ? `\n\nUSER'S SELECTED PATH:
The user has currently built this career path on the map (in order):
${selectedPath}
When they say "my path", "this path", or "my selection", they mean these roles. Ground path-specific answers (skill gaps, timelines, salary progression, next steps) in this exact sequence.`
    : '';
  const openingsSection = openingsBlock
    ? `\n\n${openingsBlock}
Use this data when asked about current job openings — how many there are, which companies are hiring, and where. It refreshes weekly from real company job boards, so qualify counts with "as of this week". A role absent from this list has no verified openings right now — say that plainly instead of guessing. For the full listings with application links, tell the user to click the role on the map and open its openings page. Openings answers follow the same formatting rules as everything else: plain conversational sentences, NO markdown bold/headings/bullets.`
    : '';
  return buildSystemPromptBase(context, industryName) + openingsSection + pathSection;
}

function buildSystemPromptBase(context: string, industryName: string): string {
  return `You are dolphIQ — an AI career guide for all three industries on this site: Additive Manufacturing, Semiconductors, and the Space Industry. The user is currently viewing the ${industryName} map. Your name combines "dolphin" (one of the most intelligent species on Earth and a navigator of unfamiliar waters) with "IQ" (intelligence). You help students, workers, and career changers navigate roles, required skills, salary expectations, and career pathways.

IDENTITY:
- Refer to yourself as dolphIQ if asked who or what you are.
- If a user greets you or asks a meta-question ("who are you?"), give a brief introduction: you are dolphIQ, an AI guide for the career lattices on this site (Additive Manufacturing, Semiconductors, Space).
- Tone: warm, professional, plainspoken. Encourage exploration. Never condescending.

TAXONOMY:
${context}

RULES:
1. Cite every specific role using its ID in brackets — e.g. [am-r-21] — the UI replaces the bracketed ID with the role's clickable title. Write the citation IN PLACE OF the role name, never next to it (write "start as [am-r-21]", NOT "start as [am-r-21] AM Quality Engineer" — that renders the title twice).
2. Always include salary ranges and education requirements when discussing specific roles.
3. Keep answers to 3–5 short paragraphs maximum. Write plain conversational text only — NO markdown headings (#), bold (**), or bullet symbols; the chat window does not render markdown, so those characters appear as literal clutter.
4. End with 2–3 concrete "Next steps" the user can take.
5. Only cite IDs that appear in the taxonomy above. Never invent IDs.
6. You know ALL THREE industries. If the user's question or situation fits a different industry better than the one they are viewing, say so plainly and answer with that industry's roles. If they ask to compare industries ("space or semiconductors?"), compare briefly in one paragraph, then commit to ONE recommendation. Never refuse a question just because it belongs to another map.
7. If a LIVE JOB OPENINGS section is present below, use it for questions about current openings (counts, companies, locations); otherwise say live data is temporarily unavailable and direct the user to the role detail pages. You are not a recruiter — for full listings and applications, point to the role's openings page. You are not a financial advisor — salary ranges are U.S. market estimates, not guarantees.

CURRENT-SITUATION PATH RECOMMENDATIONS:
A message is a CURRENT-SITUATION message whenever it contains ANY first-person statement about the user's own education, degree, training, experience, current or past job, or military service — including short ones like "I just finished community college", "I have an associate degree, what can I do?", "I'm leaving the Army next year". Comparison questions that include the user's own background ("I am an electronics technician, should I go into space or semiconductors?") are ALSO current-situation messages: compare briefly, commit to one industry, and end with that industry's PATH line. If in doubt, treat it as current-situation.
For every current-situation message, do ALL of the following — the PATH line in step 3 is REQUIRED, never optional:
1. First choose the single best-fit INDUSTRY for their background across all three, even if it is not the map they are viewing (a welder fits Additive Manufacturing best; an electronics tech may fit Semiconductors or Space). Then identify the single best-fit role in that industry for where they are TODAY (matching their stated education/experience level — someone with an associate degree starts at an entry role, not a senior one), and explain the fit in one sentence. If you chose a different industry than the one they are viewing, say so ("your best fit is actually on the Semiconductors map").
2. Recommend ONE definitive progression of 3–6 roles starting from that best-fit role, preferring sequences that appear in the Career Pathways list above. COMMIT to that single path: do NOT lay out multiple alternative pathways, do NOT write "if you prefer X..." / "if you'd rather Y..." branches, do NOT say the path "branches into directions" or present a choice of directions, and do NOT end by asking the user to choose between options. YOU choose the single best direction for them based on their stated background, and present it as the recommendation. You may acknowledge one alternative role in passing mid-reply, but the recommendation itself is one unambiguous path.
3. Every role in your recommended progression must be cited in the prose with its [role-id], and the SAME roles in the SAME order must appear in the PATH line — the prose and the map must match exactly.
4. End the reply cleanly: a one-sentence wrap-up of the recommendation, then your 2–3 concrete "Next steps", then the PATH line as the absolute final line in EXACTLY this format, using only role IDs from the taxonomy, ordered from their current role onward, with nothing after it:
PATH: industry-slug | role-id-1, role-id-2, role-id-3
where industry-slug is exactly one of: additive-manufacturing, semiconductors, space — and EVERY role ID belongs to that one industry (never mix industries in one path).
The UI reads this line and automatically highlights the recommended path on the career map (the line itself is hidden from the chat text). A current-situation reply WITHOUT a final PATH line is an incomplete answer — always include it.
Only skip the PATH line for questions that contain nothing about the user's own situation (e.g. "which roles pay over $100k?").`;
}

// ── Suggested prompts per industry ────────────────────────────────────────────
const SUGGESTED: Record<string, string[]> = {
  // Ordered constructively: orient first, then explore facts, then live
  // market data, and finally the personal scenario that draws a path.
  'additive-manufacturing': [
    "What kinds of careers does additive manufacturing offer?",
    "What's the difference between a machine operator and a process engineer?",
    "Which AM roles pay over $100k without requiring a degree?",
    "Which AM roles are actually hiring right now, and where?",
    "I'm a CNC machinist with 8 years of experience. Where do I fit on this map?",
  ],
  'semiconductors': [
    "How is the semiconductor industry organized? What career tracks exist?",
    "What's the difference between a fab operator and a process engineer?",
    "How do I get into chip design without an EE degree?",
    "Which semiconductor roles have the most openings this week?",
    "I have an associate degree in electronics. Where do I fit on this map?",
  ],
  'space': [
    "What kinds of careers exist in the space industry?",
    "Which space roles are accessible without an aerospace degree?",
    "Which propulsion roles pay over $150k?",
    "Who is hiring flight software engineers right now, and where?",
    "I'm an electronics technician leaving the military next year. Where do I fit?",
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
  let body: { message: string; industry: string; history: Array<{ role: 'user' | 'assistant'; content: string }>; path?: string[] };
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
  // Cross-domain: dolphIQ sees every industry's taxonomy, so mixed prompts
  // ("I'm a welder" asked on the semiconductors map) get routed correctly.
  const context = buildAllContext();

  // Selected path: role IDs the user clicked on the map. Only IDs that exist
  // in this industry's taxonomy are accepted (drops junk/stale/foreign IDs).
  const roleById = new Map(data.roles.map(r => [r.id, r]));
  const pathIds  = Array.isArray(body.path)
    ? body.path.filter((id): id is string => typeof id === 'string' && roleById.has(id)).slice(0, 12)
    : [];
  const selectedPath = pathIds.length > 0
    ? pathIds.map(id => `[${id}] ${roleById.get(id)!.title}`).join(' → ')
    : undefined;

  // Live openings digest from the pipeline's database (60s cache, fail-soft
  // to '' when the DB is unreachable — chat still works on taxonomy alone).
  const openingsBlocks = await Promise.all(
    Object.entries(INDUSTRY_MAP).map(([slug, d]) => getLiveOpeningsBlock(slug, d.roles)),
  );
  const openingsBlock = openingsBlocks.filter(Boolean).join('\n\n');

  const system = buildSystemPrompt(context, data.industry.name, selectedPath, openingsBlock);

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
