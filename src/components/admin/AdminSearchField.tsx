import { Search, X } from 'lucide-react';

import { cn } from '@/utils/Helpers';

type AdminSearchFieldProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
};

export function AdminSearchField({
  value,
  onChange,
  placeholder = 'Search',
  className,
  inputClassName,
}: AdminSearchFieldProps) {
  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#8E8E93]" />
      <input
        type="text"
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder={placeholder}
        className={cn(
          'w-full rounded-xl bg-[#E5E5EA] px-10 py-2.5 text-[15px] text-[#1C1C1E] placeholder-[#8E8E93] focus:outline-none focus:ring-2 focus:ring-[#007AFF]/30',
          inputClassName,
        )}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear search"
          className="absolute right-3 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded-full bg-[#8E8E93]"
        >
          <X className="size-3 text-white" />
        </button>
      )}
    </div>
  );
}
