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
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--owner-muted)]" />
      <input
        type="text"
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className={cn(
          'min-h-12 w-full rounded-2xl border border-[var(--owner-line)] bg-[var(--owner-surface)] pl-10 pr-12 text-[16px] text-[var(--owner-ink)] placeholder:text-[var(--owner-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--owner-focus)]',
          inputClassName,
        )}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear search"
          className="absolute right-1 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full text-[var(--owner-muted)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--owner-focus)]"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}
