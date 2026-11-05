import { useRef, useState } from 'react'
import { ImagePlus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { call, errorMessage } from '@/lib/api'
import { mediaUrl } from './identity'

/** Resize (and optionally square-crop) an image in the renderer before upload. */
async function prepare(file: File, max: number, square: boolean): Promise<{ base64: string; width: number; height: number }> {
  const bitmap = await createImageBitmap(file)
  let sx = 0
  let sy = 0
  let sw = bitmap.width
  let sh = bitmap.height
  if (square) {
    const side = Math.min(sw, sh)
    sx = (sw - side) / 2
    sy = (sh - side) / 2
    sw = sh = side
  }
  const scale = Math.min(1, max / Math.max(sw, sh))
  const w = Math.round(sw * scale)
  const h = Math.round(sh * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.getContext('2d')!.drawImage(bitmap, sx, sy, sw, sh, 0, 0, w, h)
  const blob: Blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Encoding failed'))), 'image/webp', 0.88))
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return { base64: btoa(bin), width: w, height: h }
}

interface ImagePickerProps {
  value: string | null | undefined
  onChange: (id: string | null) => void
  label: string
  square?: boolean
  shape?: 'circle' | 'rounded'
  disabled?: boolean
}

export function ImagePicker({ value, onChange, label, square = true, shape = 'rounded', disabled }: ImagePickerProps) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const pick = async (file: File | undefined) => {
    if (!file) return
    setBusy(true)
    try {
      const img = await prepare(file, 512, square)
      const { id } = await call('media.upload', { mime: 'image/webp', ...img })
      onChange(id)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }
  const radius = shape === 'circle' ? 'rounded-full' : 'rounded-xl'
  return (
    <div className="flex items-center gap-4">
      <button
        type="button"
        disabled={disabled || busy}
        onClick={() => input.current?.click()}
        className={`grid size-24 shrink-0 place-items-center overflow-hidden border border-dashed border-border-strong bg-surface-2 text-faint hover:border-primary hover:text-primary ${radius}`}
        aria-label={label}
      >
        {value ? <img src={mediaUrl(value)} alt="" className="size-full object-cover" /> : <ImagePlus className={busy ? 'animate-pulse' : ''} />}
      </button>
      <div className="space-y-2">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-faint">PNG, JPEG or WebP. Resized automatically.</div>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" disabled={disabled} loading={busy} onClick={() => input.current?.click()}>
            {value ? 'Replace' : 'Upload'}
          </Button>
          {value && (
            <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onChange(null)}>
              <Trash2 /> Remove
            </Button>
          )}
        </div>
      </div>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
    </div>
  )
}
