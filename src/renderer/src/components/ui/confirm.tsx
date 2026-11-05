import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button } from './button'
import { Dialog } from './dialog'

interface ConfirmOptions {
  title: string
  message?: ReactNode
  /** Rule warnings the operator must acknowledge. */
  items?: string[]
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'danger' | 'primary'
}

type ConfirmFn = (o: ConfirmOptions) => Promise<boolean>
const Ctx = createContext<ConfirmFn | null>(null)

/** Promise-based confirmation dialog used to protect critical actions. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null)
  const resolver = useRef<((v: boolean) => void) | null>(null)

  const confirm = useCallback<ConfirmFn>((o) => {
    setOpts(o)
    return new Promise<boolean>((resolve) => (resolver.current = resolve))
  }, [])

  const close = (v: boolean) => {
    resolver.current?.(v)
    resolver.current = null
    setOpts(null)
  }

  return (
    <Ctx.Provider value={confirm}>
      {children}
      <Dialog
        open={!!opts}
        onOpenChange={(o) => !o && close(false)}
        title={opts?.title ?? ''}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => close(false)}>
              {opts?.cancelLabel ?? 'Cancel'}
            </Button>
            <Button variant={opts?.tone === 'danger' ? 'danger' : 'primary'} onClick={() => close(true)} autoFocus>
              {opts?.confirmLabel ?? 'Confirm'}
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm leading-relaxed text-muted">
          {opts?.message && <div>{opts.message}</div>}
          {opts?.items && opts.items.length > 0 && (
            <ul className="space-y-2">
              {opts.items.map((w) => (
                <li key={w} className="flex gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-text">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Dialog>
    </Ctx.Provider>
  )
}

export function useConfirm(): ConfirmFn {
  const fn = useContext(Ctx)
  if (!fn) throw new Error('useConfirm must be used inside ConfirmProvider')
  return fn
}
