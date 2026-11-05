import { Switch as S } from 'radix-ui'

interface SwitchProps {
  checked: boolean
  onCheckedChange: (v: boolean) => void
  label: string
  description?: string
  disabled?: boolean
}

export function Switch({ checked, onCheckedChange, label, description, disabled }: SwitchProps) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-6 py-2.5">
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {description && <span className="mt-0.5 block text-xs text-muted">{description}</span>}
      </span>
      <S.Root
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        aria-label={label}
        className="relative h-6 w-11 shrink-0 rounded-full border border-border bg-surface-3 transition-colors data-[state=checked]:border-primary data-[state=checked]:bg-primary disabled:opacity-50"
      >
        <S.Thumb className="block size-[18px] translate-x-[2px] rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[21px]" />
      </S.Root>
    </label>
  )
}
