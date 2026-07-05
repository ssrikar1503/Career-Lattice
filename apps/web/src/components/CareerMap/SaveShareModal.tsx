'use client';

import { useState, useEffect } from 'react';
import Modal from '../Modal';

interface Props {
  open:    boolean;
  onClose: () => void;
}

/**
 * Save & Share modal — matches the Critical Materials reference site.
 * Reads the current browser URL on open (the path-with-?path= already lives there
 * thanks to CareerMap's URL sync). Provides one-click clipboard copy.
 */
export default function SaveShareModal({ open, onClose }: Props) {
  const [url, setUrl] = useState('');
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');

  // Defer the setState calls via setTimeout(0) so they aren't synchronous
  // inside the effect body (satisfies react-hooks/set-state-in-effect).
  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => {
      setUrl(typeof window !== 'undefined' ? window.location.href : '');
      setCopyState('idle');
    }, 0);
    return () => clearTimeout(id);
  }, [open]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopyState('copied');
    } catch {
      setCopyState('error');
    }
    setTimeout(() => setCopyState('idle'), 2200);
  };

  return (
    <Modal open={open} onClose={onClose} maxWidth="560px" ariaLabel="Save and share your career path">
      <div className="text-center">
        <p className="text-sm text-gray-700 leading-relaxed mb-4">
          Bookmark this page to save your career path. You can also copy/paste the link
          below to share it via email or social media:
        </p>

        <div className="flex items-center gap-2 mb-4">
          <input
            type="text"
            value={url}
            readOnly
            onClick={e => (e.target as HTMLInputElement).select()}
            aria-label="Shareable URL"
            className="flex-1 text-sm border border-gray-300 rounded px-3 py-2 bg-gray-50 text-[#1f6f7a] font-mono
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1f6f7a]"
          />
          <button
            type="button"
            onClick={handleCopy}
            className="px-4 py-2 rounded text-sm font-semibold text-white flex items-center gap-1.5 transition-colors
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1f6f7a]"
            style={{ backgroundColor: '#1f6f7a' }}
          >
            {copyState === 'copied' ? '✓ Copied' : copyState === 'error' ? 'Failed' : 'Copy'}
            {copyState === 'idle' && (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            )}
          </button>
        </div>

        <p className="text-sm text-gray-600 mb-6">
          Feel free to close this pop up and create a new career map.
        </p>

        <p className="text-base font-semibold text-gray-900">
          Congrats on taking charge of your career!
        </p>
      </div>
    </Modal>
  );
}
