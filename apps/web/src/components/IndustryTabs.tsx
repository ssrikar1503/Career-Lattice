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
      <div className="border-b border-[#e8ddcf] mb-10 flex items-center gap-6">
        <button
          type="button"
          className="pb-3 text-sm font-semibold text-[#500000] border-b-2 border-[#B7791F]"
          aria-current="page"
        >
          Build your Path
        </button>
        <button
          type="button"
          onClick={() => setAboutOpen(true)}
          className="pb-3 text-sm font-semibold text-gray-500 hover:text-[#500000] transition-colors
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-[#B7791F] rounded"
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
