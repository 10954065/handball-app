import { useRef, useState, type PointerEvent } from 'react'
import type { CameraDTO, GoalAreasDTO } from '@shared/vision'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Select } from '@/components/ui/input'
import { ErrorNote } from '@/components/ui/misc'
import { useApiMutation } from '@/lib/query'

type End = 'left' | 'right'
type Zone = [number, number, number, number]

const END_COLOUR: Record<End, string> = { left: 'var(--chart-home)', right: 'var(--chart-away)' }
const MIN_ZONE = 0.01

const clamp = (v: number) => Math.min(1, Math.max(0, v))

/** Drag on the picture to mark each goal mouth. Positions are fractions of the frame. */
export function GoalAreasDialog({ camera, onClose }: { camera: CameraDTO; onClose: () => void }) {
  const [end, setEnd] = useState<End>('left')
  const [areas, setAreas] = useState<Record<End, Zone | null>>({ left: camera.goalAreas?.left ?? null, right: camera.goalAreas?.right ?? null })
  const [leftDefendedBy, setLeftDefendedBy] = useState<GoalAreasDTO['leftDefendedBy']>(camera.goalAreas?.leftDefendedBy ?? 'home')
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null)
  const picture = useRef<HTMLDivElement>(null)
  // One picture, frozen, so the goal posts hold still while they are marked.
  const [frame] = useState(() => Date.now())
  const save = useApiMutation('cameras.setGoalAreas', { invalidate: ['cameras.'], success: 'Goal areas saved', onSuccess: onClose, toastError: false })

  const position = (e: PointerEvent) => {
    const box = picture.current!.getBoundingClientRect()
    return { x: clamp((e.clientX - box.left) / box.width), y: clamp((e.clientY - box.top) / box.height) }
  }
  const down = (e: PointerEvent) => {
    picture.current?.setPointerCapture(e.pointerId)
    setDrag(position(e))
    setAreas((a) => ({ ...a, [end]: null }))
  }
  const move = (e: PointerEvent) => {
    if (!drag) return
    const p = position(e)
    setAreas((a) => ({ ...a, [end]: [Math.min(drag.x, p.x), Math.min(drag.y, p.y), Math.max(drag.x, p.x), Math.max(drag.y, p.y)] }))
  }
  const up = () => {
    setDrag(null)
    setAreas((a) => {
      const zone = a[end]
      return zone && (zone[2] - zone[0] < MIN_ZONE || zone[3] - zone[1] < MIN_ZONE) ? { ...a, [end]: null } : a
    })
    if (end === 'left') setEnd('right')
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Mark the goal areas"
      description="Drag a box around each goal mouth. Move the camera and these need marking again."
      size="xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={!areas.left && !areas.right} loading={save.isPending} onClick={() => save.mutate({ id: camera.id, goalAreas: { ...areas, leftDefendedBy } })}>Save goal areas</Button>
        </>
      }
    >
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div role="group" aria-label="Goal being marked" className="flex gap-2">
          {(['left', 'right'] as const).map((e) => (
            <Button key={e} size="sm" variant={end === e ? 'primary' : 'secondary'} aria-pressed={end === e} onClick={() => setEnd(e)}>
              {e === 'left' ? 'Left goal' : 'Right goal'}
            </Button>
          ))}
        </div>
        <Field label="Defending the left goal now" htmlFor="left-team" className="w-56">
          <Select id="left-team" value={leftDefendedBy} onChange={(e) => setLeftDefendedBy(e.target.value as GoalAreasDTO['leftDefendedBy'])}>
            <option value="home">Home team</option>
            <option value="away">Away team</option>
          </Select>
        </Field>
      </div>
      <div ref={picture} data-testid="goal-picture" className="relative cursor-crosshair select-none overflow-hidden rounded-lg bg-black" onPointerDown={down} onPointerMove={move} onPointerUp={up}>
        <img src={`hmms-vision://frame/${camera.id}?n=marking-${frame}`} alt={`Picture from ${camera.name}`} draggable={false} className="block w-full" />
        {(['left', 'right'] as const).map((e) => {
          const zone = areas[e]
          if (!zone) return null
          return (
            <div
              key={e}
              aria-label={`${e === 'left' ? 'Left' : 'Right'} goal area`}
              role="img"
              className="pointer-events-none absolute border-2"
              style={{ left: `${zone[0] * 100}%`, top: `${zone[1] * 100}%`, width: `${(zone[2] - zone[0]) * 100}%`, height: `${(zone[3] - zone[1]) * 100}%`, borderColor: END_COLOUR[e] }}
            />
          )
        })}
      </div>
      {!!save.error && <div className="mt-3"><ErrorNote error={save.error} /></div>}
    </Dialog>
  )
}
