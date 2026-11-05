import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react'
import { Search } from 'lucide-react'
import { cn } from '@/lib/cn'

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return <table className={cn('w-full border-collapse text-sm', className)}>{children}</table>
}

export function Th({ className, ...p }: ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={cn('border-b border-border px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-faint', className)} {...p} />
}

export function Td({ className, ...p }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('px-4 py-2.5', className)} {...p} />
}

export function Tr({ className, onClick, ...p }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr onClick={onClick} className={cn('border-b border-border/60 last:border-0', onClick && 'cursor-pointer hover:bg-surface-2/70', className)} {...p} />
}

interface SearchBoxProps {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  className?: string
}

export function SearchBox({ value, onChange, placeholder = 'Search', className }: SearchBoxProps) {
  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-10 w-full rounded-md border border-border bg-surface-2 pl-9 pr-3 text-sm placeholder:text-faint focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25"
      />
    </div>
  )
}

/** Simple segmented filter control. */
export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; count?: number }[] }) {
  return (
    <div className="inline-flex rounded-lg border border-border bg-surface-2 p-0.5" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium transition-colors',
            value === o.value ? 'bg-surface-3 text-text shadow-sm' : 'text-muted hover:text-text'
          )}
        >
          {o.label}
          {o.count !== undefined && <span className="rounded bg-black/20 px-1.5 text-[11px] tabular text-faint">{o.count}</span>}
        </button>
      ))}
    </div>
  )
}
