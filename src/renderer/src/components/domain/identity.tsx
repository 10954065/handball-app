import { cn } from '@/lib/cn'
import { initials } from '@/lib/format'

export const mediaUrl = (id: string | null | undefined): string | undefined => (id ? `hmms-media://img/${id}` : undefined)

/** Readable foreground (black or white) for a team colour. */
export function contrastOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? '#0b1020' : '#ffffff'
}

interface CrestProps {
  logoMediaId?: string | null
  code: string
  color: string
  size?: number
  className?: string
}

/** Team crest: the logo if present, otherwise the team code on its colour. */
export function TeamCrest({ logoMediaId, code, color, size = 40, className }: CrestProps) {
  const style = { width: size, height: size }
  if (logoMediaId) {
    return <img src={mediaUrl(logoMediaId)} alt="" style={style} className={cn('shrink-0 rounded-lg object-contain', className)} draggable={false} />
  }
  return (
    <div
      style={{ ...style, background: color, color: contrastOn(color), fontSize: Math.max(10, size * 0.32) }}
      className={cn('grid shrink-0 place-items-center rounded-lg font-display font-bold tracking-wider ring-1 ring-white/10', className)}
      aria-hidden
    >
      {code.slice(0, 3)}
    </div>
  )
}

interface AvatarProps {
  photoMediaId?: string | null
  name: string
  size?: number
  className?: string
  rounded?: 'full' | 'lg'
}

export function PlayerAvatar({ photoMediaId, name, size = 40, className, rounded = 'full' }: AvatarProps) {
  const r = rounded === 'full' ? 'rounded-full' : 'rounded-lg'
  if (photoMediaId) {
    return <img src={mediaUrl(photoMediaId)} alt="" style={{ width: size, height: size }} className={cn('shrink-0 bg-surface-3 object-cover', r, className)} draggable={false} />
  }
  return (
    <div
      style={{ width: size, height: size, fontSize: Math.max(10, size * 0.36) }}
      className={cn('grid shrink-0 place-items-center bg-surface-3 font-semibold text-muted', r, className)}
      aria-hidden
    >
      {initials(name)}
    </div>
  )
}

interface JerseyProps {
  number: number | null
  color?: string
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

/** Jersey number chip in the team colour. */
export function Jersey({ number, color, size = 'md', className }: JerseyProps) {
  const c = color ?? '#31416a'
  const sz = size === 'lg' ? 'h-11 min-w-11 text-2xl' : size === 'sm' ? 'h-6 min-w-6 text-sm' : 'h-8 min-w-8 text-lg'
  return (
    <span
      style={{ background: c, color: contrastOn(c) }}
      className={cn('inline-grid place-items-center rounded-md px-1 font-display font-bold leading-none tabular', sz, className)}
    >
      {number ?? '-'}
    </span>
  )
}
