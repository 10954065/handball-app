import { Construction } from 'lucide-react'
import { Page } from '@/components/layout/shell'
import { EmptyState, Panel } from '@/components/ui/misc'
import type { NavItem } from '@/lib/nav'

/** Shown for modules that belong to a later development phase. Nothing here pretends to work. */
export function NotAvailablePage({ item }: { item: NavItem }) {
  return (
    <Page>
      <Panel className="mt-10">
        <EmptyState
          icon={Construction}
          title={`${item.label} is not part of this build yet`}
          message={`This module is delivered in development phase ${item.phase}. It will appear here once it has been implemented and tested.`}
        />
      </Panel>
    </Page>
  )
}
