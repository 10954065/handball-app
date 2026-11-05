import { useCallback, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/cn'

export type NoticeTone = 'success' | 'info' | 'warning' | 'error'

export interface NoticeInput {
  tone: NoticeTone
  text: string
  action?: { label: string; onClick: () => void }
}

interface Notice extends NoticeInput {
  id: number
}

const MAX_VISIBLE = 3
const LIFETIME_MS: Record<NoticeTone, number> = { success: 2500, info: 6000, warning: 6000, error: 8000 }
const TONE: Record<NoticeTone, string> = {
  success: 'border-goal/50 text-goal',
  info: 'border-primary/50 text-primary',
  warning: 'border-warning/50 text-warning',
  error: 'border-red-card/60 text-red-card'
}

/**
 * Feedback for the match centre. Unlike page toasts these stay inside the centre column: on a live
 * screen a message must never sit on top of a player tile the operator is about to press.
 */
export function useNotices() {
  const [items, setItems] = useState<Notice[]>([])
  const nextId = useRef(1)
  const dismiss = useCallback((id: number) => setItems((cur) => cur.filter((n) => n.id !== id)), [])
  const push = useCallback(
    (n: NoticeInput) => {
      const id = nextId.current++
      setItems((cur) => [...cur.slice(-(MAX_VISIBLE - 1)), { ...n, id }])
      setTimeout(() => dismiss(id), LIFETIME_MS[n.tone])
    },
    [dismiss]
  )
  return { items, push, dismiss }
}

export function NoticeStack({ items, onDismiss }: { items: Notice[]; onDismiss: (id: number) => void }) {
  return (
    <ul aria-label="Entry confirmations" aria-live="polite" className="pointer-events-none absolute inset-x-2 bottom-2 z-10 space-y-1.5">
      {items.map((n) => (
        <li
          key={n.id}
          role={n.tone === 'error' ? 'alert' : undefined}
          className={cn('pointer-events-auto flex items-center gap-2 rounded-lg border bg-surface-3 px-3 py-2 text-[12.5px] font-medium shadow-lg shadow-black/40', TONE[n.tone])}
        >
          <span className="min-w-0 flex-1 text-text">{n.text}</span>
          {n.action && (
            <button
              className="shrink-0 rounded bg-black/25 px-2 py-0.5 font-semibold hover:bg-black/40"
              onClick={() => {
                onDismiss(n.id)
                n.action?.onClick()
              }}
            >
              {n.action.label}
            </button>
          )}
          <button className="shrink-0 rounded p-0.5 text-muted hover:text-text" aria-label="Dismiss" onClick={() => onDismiss(n.id)}>
            <X className="size-3.5" />
          </button>
        </li>
      ))}
    </ul>
  )
}
