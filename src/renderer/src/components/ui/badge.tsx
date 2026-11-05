import type { HTMLAttributes } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/cn'

const badge = cva('inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide', {
  variants: {
    tone: {
      neutral: 'bg-surface-3 text-muted',
      primary: 'bg-primary/15 text-primary',
      success: 'bg-goal/15 text-goal',
      warning: 'bg-yellow-card/15 text-yellow-card',
      orange: 'bg-suspension/15 text-suspension',
      danger: 'bg-red-card/15 text-red-card',
      blue: 'bg-blue-card/15 text-blue-card',
      gold: 'bg-gold/15 text-gold',
      purple: 'bg-timeout/15 text-timeout'
    }
  },
  defaultVariants: { tone: 'neutral' }
})

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badge> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badge({ tone }), className)} {...props} />
}
