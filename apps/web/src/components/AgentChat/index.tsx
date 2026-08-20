'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import type { IndustryData } from '@/lib/types';
import DolphIQIcon, { DolphIQWordmark } from '../DolphIQIcon';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  error?: boolean;
  provider?: string; // which AI answered this message
}

interface Props {
  data: IndustryData;
}

// ── Parse [role-id] citations into clickable links ────────────────────────────
// Phase 4 - broadened regex to match Semi's descriptive IDs like
// [chief-product-architect] in addition to the original [am-r-21] / [space-r-03]
// patterns. The captured ID is validated against roleById before being treated
// as a citation - any [foo-bar] that doesn't resolve to a real role falls back
// to plain inline text, so over-matching is safe.
function RichText({ text, data }: { text: string; data: IndustryData }) {
  const roleById = new Map(data.roles.map(r => [r.id, r]));
  // Match any lowercase kebab-case identifier in square brackets.
  const parts = text.split(/(\[[a-z][a-z0-9-]*\])/g);

  return (
    <>
      {parts.map((part, i) => {
        const match = part.match(/^\[([a-z][a-z0-9-]*)\]$/);
        if (match) {
          const role = roleById.get(match[1]);
          if (role) {
            return (
              <Link
                key={i}
                href={`/${data.industry.slug}/role/${role.id}/openings`}
                className="font-semibold text-[#500000] underline decoration-[#B7791F] hover:text-[#7a2222]"
                target="_blank"
              >
                {role.title}
              </Link>
            );
          }
          // Brackets that don't resolve to a real role render as plain text
          // - no blue highlight, so dolphIQ's prose still reads cleanly even
          // when the model invents an ID or formats a non-citation bracket.
          return <span key={i}>{part}</span>;
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

const FALLBACK_MSG =
  'Rev is not available right now. Make sure at least one AI provider key is set in .env.local and restart the dev server.';

// ── PATH: line protocol ────────────────────────────────────────────────────────
// When the user describes their current situation, dolphIQ ends its reply with
// a machine-readable line like "PATH: am-r-07, am-r-12, am-r-21". The line is
// stripped from the displayed text and turned into a "Show on map" action that
// rewrites ?path= - CareerMap watches the URL and lights the path up.

/** Remove a trailing PATH: line (even a partially streamed one) from display text. */
function stripPathLine(text: string): string {
  return text.replace(/\n?\s*PATH:[^\n]*\s*$/i, '').trimEnd();
}

const INDUSTRY_NAMES: Record<string, string> = {
  'additive-manufacturing': 'Additive Manufacturing',
  'semiconductors': 'Semiconductors',
  'space': 'Space Industry',
};

/** Extract the recommended path from a completed message's PATH: line.
 *  Cross-domain format: "PATH: space | sp-r-01, sp-r-02". The slug may be
 *  omitted (legacy replies) - then the current map's industry is assumed.
 *  Same-industry IDs are validated against the loaded taxonomy; other-industry
 *  IDs are shape-checked only (the target map drops unknown IDs on load). */
function parsePathLine(
  text: string,
  validIds: Set<string>,
  currentSlug: string,
): { slug: string; ids: string[] } | null {
  const m = text.match(/^PATH:\s*(?:([a-z][a-z-]*)\s*\|)?\s*(.+?)\s*$/im);
  if (!m) return null;
  const slug = m[1] && INDUSTRY_NAMES[m[1]] ? m[1] : currentSlug;
  let ids = m[2]
    .split(/[,→>\s]+/)
    .map(s => s.trim().replace(/^\[|\]$/g, ''))
    .filter(Boolean);
  ids = slug === currentSlug
    ? ids.filter(id => validIds.has(id))
    : ids.filter(id => /^[a-z0-9][a-z0-9-]{1,60}$/.test(id));
  const deduped = [...new Set(ids)].slice(0, 12);
  return deduped.length > 0 ? { slug, ids: deduped } : null;
}

export default function AgentChat({ data }: Props) {
  const router   = useRouter();
  const pathname = usePathname();
  const [open,       setOpen]       = useState(false);
  const [messages,   setMessages]   = useState<Message[]>([]);
  const [input,      setInput]      = useState('');
  const [streaming,  setStreaming]  = useState(false);
  const [suggested,  setSuggested]  = useState<string[]>([]);
  const bottomRef   = useRef<HTMLDivElement>(null);
  const inputRef    = useRef<HTMLTextAreaElement>(null);
  const abortRef    = useRef<AbortController | null>(null);

  const validIds = useMemo(() => new Set(data.roles.map(r => r.id)), [data.roles]);

  /** Apply a dolphIQ-recommended path to the career map by rewriting ?path=.
   *  CareerMap watches the URL, so the chain + career strip light up live.
   *  window.location is read at click time (same pattern as sendMessage) to
   *  avoid useSearchParams, which would need a Suspense boundary here. */
  const applyPath = useCallback((ids: string[]) => {
    const params = new URLSearchParams(window.location.search);
    params.delete('role');
    params.set('path', ids.join(','));
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    document.getElementById('career-map')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [router, pathname]);

  // Load suggested prompts
  useEffect(() => {
    fetch(`/api/agent/chat?industry=${data.industry.slug}`)
      .then(r => r.json())
      .then(d => setSuggested(d.suggested ?? []))
      .catch(() => {});
  }, [data.industry.slug]);

  // Scroll to bottom on new message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input when panel opens
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100);
  }, [open]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || streaming) return;

    const userMsg: Message = {
      id:      Date.now().toString(),
      role:    'user',
      content: text.trim(),
    };
    const assistantId = (Date.now() + 1).toString();
    const assistantMsg: Message = { id: assistantId, role: 'assistant', content: '' };

    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setInput('');
    setStreaming(true);

    abortRef.current = new AbortController();

    try {
      const history = messages.slice(-8).map(m => ({
        role:    m.role,
        content: m.content,
      }));

      // The map keeps the selected path in the URL (?path=am-r-01,am-r-05).
      // Read it at send time so dolphIQ can answer questions about "my path".
      const path = (new URLSearchParams(window.location.search).get('path') ?? '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);

      const res = await fetch('/api/agent/chat', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          message:  text.trim(),
          industry: data.industry.slug,
          history,
          ...(path.length > 0 ? { path } : {}),
        }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: FALLBACK_MSG }));
        const errorMsg = res.status === 429
          ? `⏱ ${body.error ?? 'Rate limit reached. Please wait before sending more messages.'}`
          : body.error ?? FALLBACK_MSG;
        setMessages(prev =>
          prev.map(m => m.id === assistantId ? { ...m, content: errorMsg, error: true } : m)
        );
        return;
      }

      // Read SSE stream
      const reader  = res.body!.getReader();
      const decoder = new TextDecoder();
      let   buffer  = '';
      let   currentProvider = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (!payload) continue;

          const data_parsed = JSON.parse(payload);

          // Capture which provider answered
          if (data_parsed.provider) {
            currentProvider = data_parsed.provider;
            setMessages(prev =>
              prev.map(m => m.id === assistantId ? { ...m, provider: currentProvider } : m)
            );
          }

          if (data_parsed.done) break;
          if (data_parsed.error) {
            setMessages(prev =>
              prev.map(m => m.id === assistantId
                ? { ...m, content: data_parsed.error, error: true } : m)
            );
            break;
          }
          if (data_parsed.text) {
            setMessages(prev =>
              prev.map(m => m.id === assistantId
                ? { ...m, content: m.content + data_parsed.text } : m)
            );
          }
        }
      }
    } catch (err) {
      const name = err instanceof Error ? err.name : undefined;
      if (name !== 'AbortError') {
        setMessages(prev =>
          prev.map(m => m.id === assistantId
            ? { ...m, content: FALLBACK_MSG, error: true } : m)
        );
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }, [messages, streaming, data.industry.slug]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const clearChat = () => {
    abortRef.current?.abort();
    setMessages([]);
    setStreaming(false);
  };

  const showSuggested = messages.length === 0 && suggested.length > 0;

  return (
    <>
      {/* Floating toggle button - Rev identity */}
      <button
        onClick={() => setOpen(o => !o)}
        aria-label={open ? 'Close Rev' : 'Open Rev - your career guide'}
        aria-expanded={open}
        className="fixed bottom-6 right-6 z-40 flex items-center gap-2.5 pl-2.5 pr-4 py-2
                   rounded-full bg-white text-[#500000] font-semibold text-sm shadow-xl
                   border-2 border-[#500000]
                   hover:scale-105 active:scale-95 transition-transform duration-150
                   focus:outline-none focus-visible:ring-2 focus-visible:ring-[#B7791F]"
      >
        {open ? (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <DolphIQIcon className="w-8 h-8" />
        )}
        <span className="text-base" style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}>
          Ask <DolphIQWordmark />
        </span>
        {!open && messages.length > 0 && (
          <span className="w-2 h-2 rounded-full bg-[#B7791F]" aria-hidden="true" />
        )}
      </button>

      {/* ── Chat panel ────────────────────────────────────────────────────────── */}
      {open && (
        <div
          className="fixed bottom-20 right-6 z-40 flex flex-col bg-white rounded-2xl
                     shadow-2xl border border-[#e8ddcf] overflow-hidden
                     w-[calc(100vw-3rem)] sm:w-96"
          style={{ height: 'min(580px, calc(100vh - 160px))' }}
          role="dialog"
          aria-label="AI Career Advisor"
          aria-modal="false"
        >
          {/* Header - Rev identity + tagline + industry */}
          <div
            className="flex items-start justify-between px-4 py-3 flex-shrink-0 gap-3
                       bg-[#500000] border-b-2 border-[#B7791F]"
          >
            <div className="flex items-start gap-3 min-w-0">
              <DolphIQIcon chip className="w-10 h-10 mt-0.5 flex-shrink-0" />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-base font-bold text-white">
                    <DolphIQWordmark />
                  </span>
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0" aria-hidden="true" />
                </div>
                <p className="text-[11px] text-[#e3cf9f] leading-tight mt-0.5">
                  Your Aggie career guide
                </p>
                <p className="text-[10px] text-white/60 leading-tight mt-0.5">
                  {data.industry.name}
                </p>
              </div>
            </div>
            {messages.length > 0 && (
              <button
                onClick={clearChat}
                className="text-xs text-white/70 hover:text-white transition-colors flex-shrink-0
                           focus:outline-none focus-visible:ring-1 focus-visible:ring-[#B7791F] rounded"
                aria-label="Clear conversation"
              >
                Clear
              </button>
            )}
          </div>

          {/* Messages area */}
          <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4 min-h-0">

            {/* Welcome message - Rev introduces itself */}
            {messages.length === 0 && (
              <div className="text-center py-4">
                <DolphIQIcon className="w-16 h-16 mx-auto mb-2" />
                <p className="text-sm font-semibold text-gray-800">
                  Howdy! I&apos;m <DolphIQWordmark className="text-[#500000]" />
                </p>
                <p className="text-xs text-gray-500 mt-1.5 max-w-[260px] mx-auto leading-relaxed">
                  Ask me anything about {data.industry.name} careers - I know every role, salary, and pathway on this map.
                </p>
              </div>
            )}

            {/* Suggested prompts */}
            {showSuggested && (
              <div className="flex flex-col gap-2">
                {suggested.map(prompt => (
                  <button
                    key={prompt}
                    onClick={() => sendMessage(prompt)}
                    className="text-left text-xs px-3 py-2.5 rounded-xl border border-[#e0d5c2] bg-[#FAF7F2]
                               text-gray-700 hover:bg-[#f3ead9] hover:border-[#B7791F] transition-colors
                               focus:outline-none focus-visible:ring-2 focus-visible:ring-[#B7791F]"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            )}

            {/* Message bubbles */}
            {messages.map(msg => (
              <div
                key={msg.id}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={[
                    'max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed',
                    msg.role === 'user'
                      ? 'text-white rounded-br-sm'
                      : msg.error
                      ? 'bg-red-50 text-red-700 border border-red-200 rounded-bl-sm'
                      : 'bg-[#f5f0e6] text-gray-800 rounded-bl-sm',
                  ].join(' ')}
                  style={msg.role === 'user' ? { backgroundColor: data.industry.color } : {}}
                >
                  {msg.role === 'assistant' && !msg.error ? (
                    <>
                      <RichText text={stripPathLine(msg.content) || '…'} data={data} />
                      {/* "Show on map" action - appears when a completed reply
                          carried a PATH: line with real role IDs */}
                      {(() => {
                        const isStreamingThis =
                          streaming && msg.id === messages[messages.length - 1]?.id;
                        if (isStreamingThis) return null;
                        const parsed = parsePathLine(msg.content, validIds, data.industry.slug);
                        if (!parsed) return null;
                        const crossMap = parsed.slug !== data.industry.slug;
                        return (
                          <button
                            onClick={() => {
                              if (crossMap) {
                                router.push(`/${parsed.slug}?path=${parsed.ids.join(',')}`);
                              } else {
                                applyPath(parsed.ids);
                              }
                            }}
                            className="mt-2.5 w-full flex items-center justify-center gap-1.5
                                       rounded-xl px-3 py-2 text-xs font-semibold text-white
                                       hover:opacity-90 active:scale-[0.98] transition
                                       focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
                            style={{ backgroundColor: data.industry.color }}
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                            </svg>
                            {crossMap
                              ? `Show this path on the ${INDUSTRY_NAMES[parsed.slug]} map (${parsed.ids.length} roles)`
                              : `Show this path on the map (${parsed.ids.length} roles)`}
                          </button>
                        );
                      })()}
                      {/* Provider badge - tiny, subtle */}
                      {msg.provider && msg.content && (
                        <span className="block text-[9px] text-gray-400 mt-1.5 select-none">
                          via {msg.provider}
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="whitespace-pre-wrap">{msg.content || '…'}</span>
                  )}

                  {/* Streaming cursor */}
                  {msg.role === 'assistant' && streaming && !msg.error &&
                   msg.content === messages[messages.length - 1]?.content && (
                    <span className="inline-block w-0.5 h-3.5 bg-gray-400 ml-0.5 animate-pulse align-text-bottom"
                      aria-hidden="true" />
                  )}
                </div>
              </div>
            ))}

            <div ref={bottomRef} />
          </div>

          {/* Input area */}
          <form
            onSubmit={handleSubmit}
            className="flex-shrink-0 px-3 py-3 border-t border-[#e8ddcf] bg-white flex items-end gap-2"
          >
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about careers, skills, salaries…"
              rows={1}
              disabled={streaming}
              className="flex-1 resize-none bg-[#FAF7F2] border border-[#ddd0bb] rounded-xl
                         px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400
                         focus:outline-none focus:border-[#500000]
                         disabled:opacity-50 max-h-32 overflow-y-auto"
              style={{ lineHeight: '1.4' }}
              aria-label="Message to AI advisor"
            />
            <button
              type="submit"
              disabled={!input.trim() || streaming}
              className="flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center
                         text-white transition-opacity disabled:opacity-40
                         focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
              style={{ backgroundColor: data.industry.color }}
              aria-label="Send message"
            >
              {streaming ? (
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              )}
            </button>
          </form>

          {/* Footer disclaimer - names Rev explicitly */}
          <p className="text-center text-[10px] text-gray-500 leading-snug py-2 px-3 bg-[#FAF7F2] flex-shrink-0">
            <DolphIQWordmark /> is an AI guide. Responses may be inaccurate - verify with a human advisor before major decisions.
          </p>
        </div>
      )}
    </>
  );
}
