'use client';

interface Props {
  searchQuery: string;
  onSearch:    (q: string) => void;
}

/**
 * Reference-site search box. The earlier degree/cluster dropdowns were
 * stripped during Phase J polish — kept the search alone to match the
 * minimalism of the Critical Materials reference. Bigger and more
 * prominent than the previous compact filter row.
 */
export default function FilterBar({ searchQuery, onSearch }: Props) {
  return (
    <div className="w-full" role="search" aria-label="Filter career map">
      <div className="relative">
        <svg
          className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 pointer-events-none"
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="search"
          placeholder="Search jobs…"
          value={searchQuery}
          onChange={e => onSearch(e.target.value)}
          className="w-full pl-12 pr-10 py-3 text-base border border-gray-300 rounded-full bg-white
                     focus:outline-none focus:ring-2 focus:ring-[#1f6f7a] focus:border-transparent"
          aria-label="Search jobs"
        />
        {searchQuery && (
          <button
            onClick={() => onSearch('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full text-gray-400 hover:text-gray-700
                       hover:bg-gray-100 flex items-center justify-center text-lg leading-none
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            aria-label="Clear search"
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}
