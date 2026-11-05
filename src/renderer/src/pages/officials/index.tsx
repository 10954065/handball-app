import { useState } from 'react'
import { Archive, Building2, MapPin, Plus, Users } from 'lucide-react'
import { OFFICIAL_ROLE_LABELS } from '@shared/domain/constants'
import type { OfficialDTO, VenueDTO } from '@shared/dto'
import { Page } from '@/components/layout/shell'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState, PageHeader, Panel, Spinner } from '@/components/ui/misc'
import { SearchBox, Table, Td, Th, Tr } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useApi, useApiMutation } from '@/lib/query'
import { useSession } from '@/lib/session'
import { OfficialDialog, VenueDialog } from './forms'

export function OfficialsPage() {
  return (
    <Page>
      <PageHeader icon={Users} title="Officials & venues" subtitle="Referees, delegates, timekeepers, scorekeepers and match venues." />
      <Tabs defaultValue="officials">
        <TabsList className="mb-5">
          <TabsTrigger value="officials"><Users /> Match officials</TabsTrigger>
          <TabsTrigger value="venues"><Building2 /> Venues</TabsTrigger>
        </TabsList>
        <TabsContent value="officials"><OfficialsTab /></TabsContent>
        <TabsContent value="venues"><VenuesTab /></TabsContent>
      </Tabs>
    </Page>
  )
}

function OfficialsTab() {
  const { can } = useSession()
  const [search, setSearch] = useState('')
  const [archived, setArchived] = useState(false)
  const [edit, setEdit] = useState<OfficialDTO | 'new' | null>(null)
  const list = useApi('officials.list', { search: search || undefined, includeArchived: archived })
  const archive = useApiMutation('officials.archive', { invalidate: ['officials.'] })
  return (
    <>
      <div className="mb-4 flex items-center gap-3">
        <SearchBox value={search} onChange={setSearch} placeholder="Search name, licence or region" className="w-80" />
        <Button size="sm" variant={archived ? 'subtle' : 'ghost'} onClick={() => setArchived((a) => !a)}><Archive /> {archived ? 'Showing archived' : 'Show archived'}</Button>
        {can('manage_data') && <Button className="ml-auto" onClick={() => setEdit('new')}><Plus /> Add official</Button>}
      </div>
      <Panel>
        {list.isLoading ? (
          <Spinner />
        ) : !list.data?.length ? (
          <EmptyState icon={Users} title="No officials recorded" message="Add referees and table officials to assign them to matches." />
        ) : (
          <Table>
            <thead>
              <tr><Th>Name</Th><Th>Role</Th><Th>Licence</Th><Th>Region</Th><Th>Contact</Th><Th className="text-right">Matches</Th><Th /></tr>
            </thead>
            <tbody>
              {list.data.map((o) => (
                <Tr key={o.id}>
                  <Td className="font-medium">{o.fullName} {o.archived && <Badge className="ml-1">Archived</Badge>}</Td>
                  <Td><Badge tone={o.role === 'referee' ? 'primary' : 'neutral'}>{OFFICIAL_ROLE_LABELS[o.role]}</Badge></Td>
                  <Td className="font-mono text-xs text-muted">{o.licenseNo ?? '-'}</Td>
                  <Td className="text-muted">{o.region ?? '-'}</Td>
                  <Td className="text-xs text-muted">{[o.phone, o.email].filter(Boolean).join(' / ') || '-'}</Td>
                  <Td className="text-right tabular">{o.matchCount}</Td>
                  <Td className="text-right">
                    {can('manage_data') && (
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setEdit(o)}>Edit</Button>
                        <Button size="sm" variant="ghost" onClick={() => archive.mutate({ id: o.id, archived: !o.archived })}>{o.archived ? 'Restore' : 'Archive'}</Button>
                      </div>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
      {edit && <OfficialDialog official={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
    </>
  )
}

function VenuesTab() {
  const { can } = useSession()
  const [edit, setEdit] = useState<VenueDTO | 'new' | null>(null)
  const list = useApi('venues.list', { includeArchived: true })
  const archive = useApiMutation('venues.archive', { invalidate: ['venues.'] })
  return (
    <>
      <div className="mb-4 flex justify-end">{can('manage_data') && <Button onClick={() => setEdit('new')}><Plus /> Add venue</Button>}</div>
      {list.isLoading ? (
        <Spinner />
      ) : !list.data?.length ? (
        <Panel><EmptyState icon={MapPin} title="No venues recorded" /></Panel>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {list.data.map((v) => (
            <Panel key={v.id} className={v.archived ? 'opacity-55' : undefined}>
              <div className="flex items-start gap-3 p-5">
                <div className="grid size-10 place-items-center rounded-lg bg-primary/15 text-primary"><Building2 className="size-5" /></div>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{v.name}</div>
                  <div className="text-sm text-muted">{[v.city, v.address].filter(Boolean).join(', ') || '-'}</div>
                  <div className="mt-1 text-xs text-faint">{v.capacity ? `Capacity ${v.capacity.toLocaleString()}` : 'Capacity not recorded'}</div>
                </div>
                {can('manage_data') && (
                  <div className="flex flex-col gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setEdit(v)}>Edit</Button>
                    <Button size="sm" variant="ghost" onClick={() => archive.mutate({ id: v.id, archived: !v.archived })}>{v.archived ? 'Restore' : 'Archive'}</Button>
                  </div>
                )}
              </div>
            </Panel>
          ))}
        </div>
      )}
      {edit && <VenueDialog venue={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
    </>
  )
}
