import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/cn'

export const buttonVariants = cva(
  'relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium transition-[background,color,box-shadow,transform] duration-150 select-none disabled:pointer-events-none disabled:opacity-45 active:translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-fg hover:bg-primary-strong shadow-sm shadow-primary/20',
        secondary: 'bg-surface-3 text-text hover:bg-surface-hover border border-border',
        outline: 'border border-border-strong bg-transparent text-text hover:bg-surface-2',
        ghost: 'bg-transparent text-muted hover:text-text hover:bg-surface-2',
        danger: 'bg-danger text-white hover:bg-red-600 shadow-sm shadow-red-900/30',
        success: 'bg-goal text-white hover:bg-goal-strong shadow-sm shadow-green-900/30',
        subtle: 'bg-primary/12 text-primary hover:bg-primary/20'
      },
      size: {
        sm: 'h-8 px-3 text-[13px] [&_svg]:size-3.5',
        md: 'h-10 px-4 text-sm [&_svg]:size-4',
        lg: 'h-12 px-5 text-base [&_svg]:size-5',
        xl: 'h-16 px-6 text-lg font-semibold [&_svg]:size-6',
        icon: 'size-9 [&_svg]:size-4',
        'icon-sm': 'size-8 [&_svg]:size-3.5'
      }
    },
    defaultVariants: { variant: 'primary', size: 'md' }
  }
)

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  loading?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, loading, disabled, children, type = 'button', ...props },
  ref
) {
  return (
    <button ref={ref} type={type} className={cn(buttonVariants({ variant, size }), className)} disabled={disabled || loading} {...props}>
      {loading && <Loader2 className="animate-spin" aria-hidden />}
      {children}
    </button>
  )
})
