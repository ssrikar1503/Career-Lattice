'use client';

import { useState } from 'react';
import AboutModal from './CareerMap/AboutModal';

interface Props {
  industryName: string;
}

/**
 * The "Build your Path" / "About this Map / FAQs" tabs under the page H1.
 * The first tab is the current page; the second tab opens the About modal.
 */
export default function IndustryTabs({ industryName }: Props) {
  const [aboutOpen, setAboutOpen] = useState(false);

  return (
    <>
      <div className="border-b border-gray-200 mb-10 flex items-center gap-6">
        <button
          type="button"
          className="pb-3 text-sm font-semibold text-gray-900 border-b-2 border-gray-900"
          aria-current="page"
        >
          Build your Path
        </button>
        <button
          type="button"
          onClick={() => setAboutOpen(true)}
          className="pb-3 text-sm font-semibold text-gray-500 hover:text-gray-700 transition-colors
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
          aria-haspopup="dialog"
        >
          About this Map / FAQs
        </button>
      </div>

      <AboutModal
        open={aboutOpen}
        onClose={() => setAboutOpen(false)}
        industryName={industryName}
      />
    </>
  );
}
