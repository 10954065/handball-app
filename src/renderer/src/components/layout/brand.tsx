import { cn } from '@/lib/cn'

/** HMMS mark: a handball with panel seams inside a court-line ring. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={cn('size-9', className)} aria-hidden>
      <defs>
        <linearGradient id="hmms-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffd45a" />
          <stop offset="1" stopColor="#f59e0b" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="46" height="46" rx="12" fill="#0f1a33" stroke="#2a3a63" />
      <circle cx="24" cy="24" r="13" fill="url(#hmms-g)" />
      <path d="M11.5 21.5c5 2.2 9.5 2.2 13.5-.8 3.6-2.7 7.7-3 11.5-1.4" fill="none" stroke="#0f1a33" strokeWidth="2" strokeLinecap="round" />
      <path d="M19 11.8c2.6 4.3 3 8.4 1.2 12.8-1.6 4-1.2 8 .9 11.6" fill="none" stroke="#0f1a33" strokeWidth="2" strokeLinecap="round" />
      <path d="M30.5 12.6c-.6 3.8.4 7 3 9.7 2.3 2.4 3.2 5.6 2.4 9" fill="none" stroke="#0f1a33" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

export function BrandWordmark({ collapsed }: { collapsed?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <BrandMark />
      {!collapsed && (
        <div className="leading-none">
          <div className="font-display text-xl font-bold tracking-[0.12em]">HMMS</div>
          <div className="mt-1 text-[10px] font-medium uppercase tracking-[0.14em] text-faint">Match Management</div>
        </div>
      )}
    </div>
  )
}
