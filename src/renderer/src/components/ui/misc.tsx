import type { ReactNode } from 'react'
import { Loader2, type LucideIcon } from 'lucide-react'
import { ApiError } from '@/lib/api'
import { cn } from '@/lib/cn'

export function Panel({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cn('rounded-xl border border-border bg-surface-1', className)}>{children}</section>
}

interface PanelHeaderProps {
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  className?: string
}

export function PanelHeader({ title, subtitle, actions, className }: PanelHeaderProps) {
  return (
    <div className={cn('flex items-center justify-between gap-3 border-b border-border px-5 py-3.5', className)}>
      <div className="min-w-0">
        <h2 className="truncate text-[13px] font-semibold uppercase tracking-wider text-muted">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-faint">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  )
}

interface PageHeaderProps {
  title: string
  subtitle?: string
  actions?: ReactNode
  icon?: LucideIcon
}

export function PageHeader({ title, subtitle, actions, icon: Icon }: PageHeaderProps) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 pb-6">
      <div className="flex items-center gap-3.5">
        {Icon && (
          <div className="grid size-11 place-items-center rounded-lg border border-border bg-surface-2 text-primary">
            <Icon className="size-5" />
          </div>
        )}
        <div>
          <h1 className="font-display text-[28px] font-semibold leading-none tracking-wide">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-muted">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  )
}

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  message?: string
  action?: ReactNode
  className?: string
}

export function EmptyState({ icon: Icon, title, message, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-14 text-center', className)}>
      <div className="mb-4 grid size-14 place-items-center rounded-2xl border border-dashed border-border-strong text-faint">
        <Icon className="size-6" />
      </div>
      <p className="font-medium text-text">{title}</p>
      {message && <p className="mt-1 max-w-sm text-sm text-muted">{message}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export function Spinner({ label = 'Loading', className }: { label?: string; className?: string }) {
  return (
    <div className={cn('flex items-center justify-center gap-2 py-10 text-sm text-muted', className)} role="status">
      <Loader2 className="size-4 animate-spin" />
      {label}
    </div>
  )
}

export function ErrorNote({ error }: { error: unknown }) {
  const msg = error instanceof Error ? error.message : 'Something went wrong.'
  const details = error instanceof ApiError ? (error.details ?? []).map((d) => d.replace(/^[\w.]+: /, '')) : []
  return (
    <div className="rounded-md border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-red-300">
      {msg}
      {details.length > 0 && <ul className="mt-1 list-disc pl-4">{details.map((d) => <li key={d}>{d}</li>)}</ul>}
    </div>
  )
}

interface StatProps {
  label: string
  value: ReactNode
  hint?: ReactNode
  accent?: string
}

export function Stat({ label, value, hint, accent }: StatProps) {
  return (
    <div className="rounded-xl border border-border bg-surface-1 px-5 py-4">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</p>
      <p className={cn('mt-2 font-display text-4xl font-semibold leading-none tabular', accent)}>{value}</p>
      {hint && <p className="mt-2 text-xs text-faint">{hint}</p>}
    </div>
  )
}
