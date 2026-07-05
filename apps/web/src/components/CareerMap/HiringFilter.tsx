'use client';

interface Props {
  checked:  boolean;
  onChange: (checked: boolean) => void;
  hiringCount: number;
  totalCount:  number;
}

/**
 * Compact checkbox under the search bar. When checked, the map hides every
 * role with zero open jobs worldwide. The count text gives the user a feel
 * for how sparse the result will be ("Show only hiring (84/158)") so they
 * know what to expect before they toggle.
 */
export default function HiringFilter({ checked, onChange, hiringCount, totalCount }: Props) {
  return (
    <label
      className="inline-flex items-center gap-2 cursor-pointer select-none px-3 py-1.5 rounded-full
                 border border-gray-300 bg-white text-xs font-medium text-gray-700
                 hover:bg-gray-50 transition-colors
                 focus-within:ring-2 focus-within:ring-[#1f6f7a]"
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        className="w-3.5 h-3.5 accent-[#1f6f7a] cursor-pointer"
      />
      <span>
        Show only hiring{' '}
        <span className="text-gray-500">
          ({hiringCount}/{totalCount})
        </span>
      </span>
    </label>
  );
}
