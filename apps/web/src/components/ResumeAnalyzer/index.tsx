'use client';

/**
 * Resume upload → "find your place on the map".
 *
 * Drag-and-drop or browse a PDF/DOCX resume; the analyzer matches it against
 * the role taxonomy and returns top role fits, matched vs. missing skills,
 * and a recommended growth path that can be applied to the career map with
 * one click (same ?path= mechanism Rev uses).
 *
 * Privacy: the file goes straight to /api/resume/analyze, is parsed in
 * memory, and is never stored. That promise is stated in the UI.
 */

import { useCallback, useRef, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { formatSalary } from '@/components/CareerMap/constants';
import { programsFor } from '@/lib/education';

interface MatchResult {
  role_id:         string;
  title:           string;
  seniority:       string;
  salary_min:      number;
  salary_max:      number;
  degree_required: string;
  confidence:      number;
  matched_skills:  string[];
  gap_skills:      string[];
  why:             string;
}
interface AnalysisResult {
  education_level:  string;
  years_experience: number;
  current_title:    string;
  summary:          string;
  best_industry:    string;
  industry_name:    string;
  matches:          MatchResult[];
  recommended_path: string[];
}

const MAX_BYTES = 4 * 1024 * 1024;
const ACCEPT = '.pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

type Phase = 'idle' | 'uploading' | 'done' | 'error';

export default function ResumeAnalyzer({ industrySlug }: { industrySlug: string }) {
  const router   = useRouter();
  const pathname = usePathname();
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase,    setPhase]    = useState<Phase>('idle');
  const [dragOver, setDragOver] = useState(false);
  const [error,    setError]    = useState<string>('');
  const [result,   setResult]   = useState<AnalysisResult | null>(null);

  const analyze = useCallback(async (file: File) => {
    setError('');
    if (file.size > MAX_BYTES) { setError('File is too large. Please keep it under 4 MB.'); setPhase('error'); return; }
    const okType = /\.(pdf|docx)$/i.test(file.name);
    if (!okType) { setError('Please upload a PDF or DOCX file.'); setPhase('error'); return; }

    setPhase('uploading');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/resume/analyze', { method: 'POST', body: fd });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body || body.error) {
        setError(body?.error ?? 'Something went wrong. Please try again.');
        setPhase('error');
        return;
      }
      setResult(body as AnalysisResult);
      setPhase('done');
    } catch {
      setError('Network problem while uploading. Please try again.');
      setPhase('error');
    }
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) analyze(file);
  }, [analyze]);

  const applyPath = useCallback(() => {
    if (!result) return;
    const ids = result.recommended_path.join(',');
    if (result.best_industry === industrySlug) {
      const params = new URLSearchParams(window.location.search);
      params.delete('role');
      params.set('path', ids);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
      document.getElementById('career-map')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      router.push(`/${result.best_industry}?path=${ids}`);
    }
  }, [result, industrySlug, router, pathname]);

  const reset = () => { setPhase('idle'); setResult(null); setError(''); };

  const confidenceLabel = (c: number) =>
    c >= 0.8 ? 'Strong fit' : c >= 0.6 ? 'Good fit' : 'Possible fit';

  const educationLabel: Record<string, string> = {
    hs: 'High school', '2yr': 'Associate level', '4yr': "Bachelor's level", graduate: 'Graduate level',
  };

  return (
    <section
      className="mt-6 rounded-lg border border-gray-200 bg-white px-5 py-4"
      aria-label="Resume analyzer"
    >
      <div className="flex items-center gap-2 mb-1">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
             className="text-[#500000]" aria-hidden="true">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <path d="M14 2v6h6" /><path d="M9 15l2 2 4-4" />
        </svg>
        <h2 className="text-sm font-semibold text-gray-900">Find your place on the map</h2>
      </div>
      <p className="text-xs text-gray-500 mb-3">
        Upload your resume and we&apos;ll match you to real roles, show your skill gaps, and chart your path.
      </p>

      {phase === 'idle' || phase === 'error' ? (
        <>
          <div
            role="button"
            tabIndex={0}
            aria-label="Upload your resume, PDF or DOCX, max 4 megabytes"
            onClick={() => inputRef.current?.click()}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click(); } }}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            className={`flex flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed px-4 py-6
                        cursor-pointer transition-colors text-center
                        focus:outline-none focus-visible:ring-2 focus-visible:ring-[#B7791F]
                        ${dragOver ? 'border-[#500000] bg-[#f5f5f5]' : 'border-gray-300 hover:border-[#500000] hover:bg-[#fafafa]'}`}
          >
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
                 className="text-gray-400" aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <path d="M17 8l-5-5-5 5" /><path d="M12 3v12" />
            </svg>
            <span className="text-sm font-medium text-gray-700">Drop your resume here or click to browse</span>
            <span className="text-[11px] text-gray-400">PDF or DOCX, up to 4 MB</span>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) analyze(f); e.target.value = ''; }}
          />
          {phase === 'error' && (
            <p role="alert" className="mt-2 text-xs text-red-700">{error}</p>
          )}
          <p className="mt-2 text-[10px] text-gray-400">
            Your resume is analyzed in memory and never stored.
          </p>
        </>
      ) : phase === 'uploading' ? (
        <div className="flex items-center gap-3 rounded-lg border border-gray-200 px-4 py-5" aria-live="polite">
          <svg className="animate-spin text-[#500000]" width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.2" />
            <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
          <div>
            <p className="text-sm font-medium text-gray-800">Analyzing your resume…</p>
            <p className="text-[11px] text-gray-500">Reading experience, matching skills to 258 roles. Takes ~15 seconds.</p>
          </div>
        </div>
      ) : result ? (
        <div aria-live="polite">
          {/* Profile strip */}
          <div className="rounded-lg bg-[#f5f5f5] px-4 py-3 mb-3">
            <p className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold mb-0.5">
              {result.current_title}
              {result.years_experience > 0 ? ` · ${result.years_experience} yr${result.years_experience === 1 ? '' : 's'} experience` : ''}
              {' · '}{educationLabel[result.education_level] ?? result.education_level}
            </p>
            <p className="text-[13px] text-gray-700 leading-snug">{result.summary}</p>
            {result.best_industry !== industrySlug && (
              <p className="mt-1.5 text-[12px] font-medium text-[#500000]">
                Your background fits the {result.industry_name} map best - your matches below are from there.
              </p>
            )}
          </div>

          {/* Matches */}
          <ul className="flex flex-col gap-3" role="list">
            {result.matches.map((m, i) => (
              <li key={m.role_id} className="rounded-lg border border-gray-200 px-4 py-3">
                <div className="flex items-baseline justify-between gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-gray-900">
                    {i + 1}. {m.title}
                  </span>
                  <span className="text-[11px] font-semibold text-[#500000]">
                    {confidenceLabel(m.confidence)} · {Math.round(m.confidence * 100)}%
                  </span>
                </div>
                {/* Confidence bar */}
                <div className="mt-1.5 h-1.5 rounded-full bg-gray-100 overflow-hidden" aria-hidden="true">
                  <div className="h-full rounded-full bg-[#500000]" style={{ width: `${Math.round(m.confidence * 100)}%` }} />
                </div>
                <p className="mt-1.5 text-[12px] text-gray-600">
                  {formatSalary(m.salary_min, m.salary_max)} · {m.why}
                </p>
                {(m.matched_skills.length > 0 || m.gap_skills.length > 0) && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {m.matched_skills.map(s => (
                      <span key={`h-${s}`} className="text-[11px] px-2 py-0.5 rounded-full bg-[#f0f7f0] text-[#1b5e20] border border-[#c8e0c9]">
                        ✓ {s}
                      </span>
                    ))}
                    {m.gap_skills.map(s => (
                      <span key={`g-${s}`} className="text-[11px] px-2 py-0.5 rounded-full bg-[#faf3f3] text-[#7a2222] border border-[#e5cccc]">
                        + {s}
                      </span>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>

          {/* Path CTA */}
          <button
            type="button"
            onClick={applyPath}
            className="mt-3 w-full px-4 py-2.5 rounded-lg bg-[#500000] text-white text-sm font-semibold
                       hover:bg-[#6d1f1f] transition-colors
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#B7791F]"
          >
            Show my recommended path on the map ({result.recommended_path.length} steps)
          </button>

          {/* Education for the top match's tier */}
          {(() => {
            const top = result.matches[0];
            const programs = top ? programsFor(result.best_industry, top.degree_required).slice(0, 2) : [];
            if (programs.length === 0) return null;
            return (
              <p className="mt-2.5 text-[12px] text-gray-600 leading-snug">
                Close your skill gaps:{' '}
                {programs.map((p, i) => (
                  <span key={p.url}>
                    {i > 0 && ' · '}
                    <a href={p.url} target="_blank" rel="noopener noreferrer"
                       className="text-[#500000] underline decoration-[#B7791F] underline-offset-2">
                      {p.institution} {p.program}
                    </a>
                  </span>
                ))}
              </p>
            );
          })()}

          <button
            type="button"
            onClick={reset}
            className="mt-3 text-[12px] text-gray-500 hover:text-[#500000] underline underline-offset-2
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-[#B7791F] rounded"
          >
            Analyze a different resume
          </button>
        </div>
      ) : null}
    </section>
  );
}
