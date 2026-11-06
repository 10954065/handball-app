import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { SHIRT_SLOTS, shirtLabels, type ShirtsDTO, type ShirtSlot, type TeamSheetDTO } from '@shared/vision'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { ErrorNote, Spinner } from '@/components/ui/misc'
import { useApiMutation } from '@/lib/query'

const PATCH = 9

const hex = (v: number) => Math.round(v).toString(16).padStart(2, '0')

/** The middle colour of a small patch, so a number or a fold on the shirt does not decide it. */
export function patchColour(data: Uint8ClampedArray): string {
  const channel = (offset: number) => {
    const values: number[] = []
    for (let i = offset; i < data.length; i += 4) values.push(data[i])
    return values.sort((a, b) => a - b)[values.length >> 1]
  }
  return `#${hex(channel(0))}${hex(channel(1))}${hex(channel(2))}`
}

export function ShirtSwatches({ shirts, sheet }: { shirts: ShirtsDTO; sheet: TeamSheetDTO | null | undefined }) {
  const labels = shirtLabels(sheet)
  const picked = SHIRT_SLOTS.filter((s) => shirts[s])
  if (!picked.length) return <span className="text-xs text-muted">No colours set, so everyone on court is followed.</span>
  return (
    <span className="flex items-center gap-1.5">
      {picked.map((s) => <span key={s} title={labels[s]} aria-label={`${labels[s]} colour`} role="img" className="size-4 rounded border border-border-strong" style={{ background: shirts[s] }} />)}
    </span>
  )
}

/** Click one shirt for each group on a paused picture. */
export function ShirtDialog({ cameraId, shirts, sheet, onClose }: { cameraId: string; shirts: ShirtsDTO; sheet: TeamSheetDTO | null | undefined; onClose: () => void }) {
  const labels = shirtLabels(sheet)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const [slot, setSlot] = useState<ShirtSlot>('a')
  const [picked, setPicked] = useState<ShirtsDTO>(shirts)
  const save = useApiMutation('vision.setShirts', { invalidate: ['vision.shirts'], success: 'Shirt colours saved', onSuccess: onClose, toastError: false })

  // Fetched rather than shown in an <img>, because a page cannot read pixels from another scheme.
  useEffect(() => {
    let cancelled = false
    fetch(`hmms-vision://frame/${cameraId}`)
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error('No picture yet'))))
      .then(createImageBitmap)
      .then((bitmap) => {
        const c = canvas.current
        if (cancelled || !c) return
        c.width = bitmap.width
        c.height = bitmap.height
        c.getContext('2d', { willReadFrequently: true })?.drawImage(bitmap, 0, 0)
        setReady(true)
      })
      .catch(() => !cancelled && setFailed(true))
    return () => {
      cancelled = true
    }
  }, [cameraId])

  const pick = (e: MouseEvent<HTMLCanvasElement>) => {
    const c = e.currentTarget
    const box = c.getBoundingClientRect()
    const x = Math.round(((e.clientX - box.left) / box.width) * c.width)
    const y = Math.round(((e.clientY - box.top) / box.height) * c.height)
    const half = PATCH >> 1
    const data = c.getContext('2d')?.getImageData(Math.max(0, x - half), Math.max(0, y - half), PATCH, PATCH).data
    if (!data) return
    setPicked((p) => ({ ...p, [slot]: patchColour(data) }))
    const next = SHIRT_SLOTS[SHIRT_SLOTS.indexOf(slot) + 1]
    if (next) setSlot(next)
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Set shirt colours"
      description="Click a shirt for each group. A goalkeeper in a different colour can have their own. If both teams wear the same shirts, click their shorts as well."
      size="xl"
      footer={
        <>
          <Button variant="ghost" onClick={() => setPicked({})}>Clear all</Button>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={save.isPending} onClick={() => save.mutate(picked)}>Save colours</Button>
        </>
      }
    >
      <div role="group" aria-label="Shirt being set" className="mb-3 flex flex-wrap gap-2">
        {SHIRT_SLOTS.map((s) => (
          <Button key={s} size="sm" variant={slot === s ? 'primary' : 'secondary'} aria-pressed={slot === s} onClick={() => setSlot(s)}>
            {picked[s] && <span className="size-3.5 rounded-sm border border-white/40" style={{ background: picked[s] }} />}
            {labels[s]}
          </Button>
        ))}
      </div>
      {!ready && !failed && <Spinner label="Getting a picture" />}
      {failed && <ErrorNote error={new Error('No picture is available from this camera yet. Try again in a moment.')} />}
      <canvas ref={canvas} aria-label="Paused picture. Click a shirt." className={ready ? 'block w-full cursor-crosshair rounded-lg' : 'hidden'} onClick={pick} />
      {!!save.error && <div className="mt-3"><ErrorNote error={save.error} /></div>}
    </Dialog>
  )
}
