'use client';

import { useEffect, useRef } from 'react';

interface Props {
  open:        boolean;
  onClose:     () => void;
  title?:      string;
  maxWidth?:   string;
  children:    React.ReactNode;
  /** Optional aria-label when there's no visible title. */
  ariaLabel?:  string;
  /** Skip the default content padding — caller handles its own. */
  noPadding?:  boolean;
  /** Override the close button's color classes (text + hover bg).
   *  Default is gray-on-white; pass white-on-colored when the close button
   *  sits over a colored header band. */
  closeButtonClass?: string;
}

/**
 * Shared modal — backdrop + centered card + Esc-to-close + click-outside-to-close.
 *
 * Used by:
 *  - About this Map / FAQs (Phase J4)
 *  - Save & Share (Phase J4)
 *  - Error: "map has changed…" (Phase J4 → J10)
 *  - Role detail (Phase J6)
 */
export default function Modal({
  open, onClose, title, maxWidth = '720px', children, ariaLabel,
  noPadding = false,
  closeButtonClass = 'text-gray-500 hover:text-gray-900 hover:bg-gray-100',
}: Props) {
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  // Esc closes the modal; focus the close button on open
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    // Focus the close button so screen readers + keyboard users know we opened
    closeBtnRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Lock body scroll while open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? 'modal-title' : undefined}
      aria-label={!title ? ariaLabel : undefined}
    >
      {/* Backdrop */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close modal"
        className="absolute inset-0 bg-black/40 backdrop-blur-[1px] cursor-default
                   focus:outline-none"
      />

      {/* Card */}
      <div
        className="relative bg-white rounded-lg shadow-2xl w-full max-h-[90vh] overflow-y-auto"
        style={{ maxWidth }}
        onClick={e => e.stopPropagation()}
      >
        {/* Close button (always top-right) */}
        <button
          ref={closeBtnRef}
          type="button"
          onClick={onClose}
          aria-label="Close"
          className={`absolute top-3 right-3 w-8 h-8 rounded-full ${closeButtonClass}
                     flex items-center justify-center z-10
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500`}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        {title && (
          <div className="px-6 pt-6 pr-12">
            <h2 id="modal-title" className="text-xl font-bold text-gray-900">
              {title}
            </h2>
          </div>
        )}

        <div className={title ? 'px-6 pt-4 pb-6' : noPadding ? '' : 'p-6 pr-12'}>
          {children}
        </div>
      </div>
    </div>
  );
}
