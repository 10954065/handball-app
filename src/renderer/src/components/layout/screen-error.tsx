import { useEffect } from 'react'
import { useRouteError } from 'react-router-dom'
import { TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { reportError } from '@/lib/report-error'

function reloadAt(hash: string): void {
  location.hash = hash
  location.reload()
}

/**
 * Shown instead of a blank window when a screen fails. Reloading it loses nothing that was saved.
 * A public screen offers no way into the operator's screens.
 */
export function ScreenError({ publicScreen = false }: { publicScreen?: boolean }) {
  const error = useRouteError()
  useEffect(() => reportError(error), [error])
  return (
    <div role="alert" className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <TriangleAlert className="size-10 text-warning" />
      <h1 className="font-display text-2xl font-semibold">This screen hit a problem</h1>
      {!publicScreen && (
        <p className="max-w-md text-sm text-muted">
          Everything already saved is safe, including any match in progress. Reload the screen to carry on. If it happens again, the details are in the log folder under Settings, System & audit.
        </p>
      )}
      <div className="mt-2 flex gap-2">
        <Button onClick={() => location.reload()}>Reload this screen</Button>
        {!publicScreen && (
          <Button variant="secondary" onClick={() => reloadAt('#/')}>
            Go to the dashboard
          </Button>
        )}
      </div>
    </div>
  )
}
