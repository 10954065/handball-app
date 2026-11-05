import type { ReactNode } from 'react'
import { Tabs as T } from 'radix-ui'
import { cn } from '@/lib/cn'

export const Tabs = T.Root
export const TabsContent = T.Content

export function TabsList({ children, className }: { children: ReactNode; className?: string }) {
  return <T.List className={cn('flex gap-1 border-b border-border', className)}>{children}</T.List>
}

export function TabsTrigger({ value, children }: { value: string; children: ReactNode }) {
  return (
    <T.Trigger
      value={value}
      className="relative -mb-px flex items-center gap-2 border-b-2 border-transparent px-4 py-2.5 text-sm font-medium text-muted hover:text-text data-[state=active]:border-primary data-[state=active]:text-text [&_svg]:size-4"
    >
      {children}
    </T.Trigger>
  )
}
