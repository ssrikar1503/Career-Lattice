'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import Link from 'next/link';
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
// Phase 4 — broadened regex to match Semi's descriptive IDs like
// [chief-product-architect] in addition to the original [am-r-21] / [space-r-03]
// patterns. The captured ID is validated against roleById before being treated
// as a citation — any [foo-bar] that doesn't resolve to a real role falls back
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
                className="font-semibold text-blue-400 hover:text-blue-300 hover:underline"
                target="_blank"
              >
                {role.title}
              </Link>
            );
          }
          // Brackets that don't resolve to a real role render as plain text
          // — no blue highlight, so dolphIQ's prose still reads cleanly even
          // when the model invents an ID or formats a non-citation bracket.
          return <span key={i}>{part}</span>;
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

const FALLBACK_MSG =
  'dolphIQ is not available right now. Make sure at least one AI provider key is set in .env.local and restart the dev server.';

export default function AgentChat({ data }: Props) {
  const [open,       setOpen]       = useState(false);
  const [messages,   setMessages]   = useState<Message[]>([]);
  const [input,      setInput]      = useState('');
  const [streaming,  setStreaming]  = useState(false);
  const [suggested,  setSuggested]  = useState<string[]>([]);
  const bottomRef   = useRef<HTMLDivElement>(null);
  const inputRef    = useRef<HTMLTextAreaElement>(null);
  const abortRef    = useRef<AbortController | null>(null);

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
      {/* Floating toggle button — dolphIQ identity */}
      <button
        onClick={() => setOpen(o => !o)}
        aria-label={open ? 'Close dolphIQ' : 'Open dolphIQ — your career guide'}
        aria-expanded={open}
        className="fixed bottom-6 right-6 z-40 flex items-center gap-2 px-4 py-3
                   rounded-2xl text-white font-semibold text-sm shadow-xl
                   hover:scale-105 active:scale-95 transition-transform duration-150
                   focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
        style={{ backgroundColor: data.industry.color }}
      >
        {open ? (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <DolphIQIcon className="w-6 h-4" />
        )}
        <DolphIQWordmark />
        {!open && messages.length > 0 && (
          <span className="w-2 h-2 rounded-full bg-white/70" aria-hidden="true" />
        )}
      </button>

      {/* ── Chat panel ────────────────────────────────────────────────────────── */}
      {open && (
        <div
          className="fixed bottom-20 right-6 z-40 flex flex-col bg-gray-950 rounded-2xl
                     shadow-2xl border border-gray-800 overflow-hidden
                     w-[calc(100vw-3rem)] sm:w-96"
          style={{ height: 'min(580px, calc(100vh - 160px))' }}
          role="dialog"
          aria-label="AI Career Advisor"
          aria-modal="false"
        >
          {/* Header — dolphIQ identity + tagline + industry */}
          <div
            className="flex items-start justify-between px-4 py-3 flex-shrink-0 gap-3"
            style={{ backgroundColor: `${data.industry.color}22`, borderBottom: `1px solid ${data.industry.color}33` }}
          >
            <div className="flex items-start gap-2.5 min-w-0">
              <DolphIQIcon className="w-7 h-5 text-white mt-0.5 flex-shrink-0" />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-white">
                    <DolphIQWordmark />
                  </span>
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0" aria-hidden="true" />
                </div>
                <p className="text-[11px] text-gray-300 leading-tight mt-0.5">
                  Intelligent navigation for your career
                </p>
                <p className="text-[10px] text-gray-500 leading-tight mt-0.5">
                  {data.industry.name}
                </p>
              </div>
            </div>
            {messages.length > 0 && (
              <button
                onClick={clearChat}
                className="text-xs text-gray-500 hover:text-gray-300 transition-colors flex-shrink-0
                           focus:outline-none focus-visible:ring-1 focus-visible:ring-gray-400 rounded"
                aria-label="Clear conversation"
              >
                Clear
              </button>
            )}
          </div>

          {/* Messages area */}
          <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4 min-h-0">

            {/* Welcome message — dolphIQ introduces itself */}
            {messages.length === 0 && (
              <div className="text-center py-4">
                <DolphIQIcon className="w-12 h-8 text-white/90 mx-auto mb-2" />
                <p className="text-sm font-semibold text-gray-200">
                  Hi, I&apos;m <DolphIQWordmark />
                </p>
                <p className="text-xs text-gray-400 mt-1.5 max-w-[260px] mx-auto leading-relaxed">
                  Ask me anything about {data.industry.name} careers — I know every role, salary, and pathway on this map.
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
                    className="text-left text-xs px-3 py-2.5 rounded-xl border border-gray-700
                               text-gray-300 hover:bg-gray-800 hover:border-gray-600 transition-colors
                               focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
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
                      ? 'bg-red-950 text-red-300 border border-red-800 rounded-bl-sm'
                      : 'bg-gray-800 text-gray-100 rounded-bl-sm',
                  ].join(' ')}
                  style={msg.role === 'user' ? { backgroundColor: data.industry.color } : {}}
                >
                  {msg.role === 'assistant' && !msg.error ? (
                    <>
                      <RichText text={msg.content || '…'} data={data} />
                      {/* Provider badge — tiny, subtle */}
                      {msg.provider && msg.content && (
                        <span className="block text-[9px] text-gray-600 mt-1.5 select-none">
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
            className="flex-shrink-0 px-3 py-3 border-t border-gray-800 bg-gray-900 flex items-end gap-2"
          >
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about careers, skills, salaries…"
              rows={1}
              disabled={streaming}
              className="flex-1 resize-none bg-gray-800 border border-gray-700 rounded-xl
                         px-3 py-2.5 text-sm text-gray-100 placeholder-gray-500
                         focus:outline-none focus:border-gray-500
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

          {/* Footer disclaimer — names dolphIQ explicitly */}
          <p className="text-center text-[10px] text-gray-400 leading-snug py-2 px-3 bg-gray-900 flex-shrink-0">
            <DolphIQWordmark /> is an AI guide. Responses may be inaccurate — verify with a human advisor before major decisions.
          </p>
        </div>
      )}
    </>
  );
}
