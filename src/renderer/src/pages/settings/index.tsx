import { Cog, DatabaseBackup, Info, Settings as SettingsIcon, Users } from 'lucide-react'
import { Page } from '@/components/layout/shell'
import { PageHeader } from '@/components/ui/misc'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { BackupSettings } from './backup'
import { GeneralSettings } from './general'
import { SystemSettings } from './system'
import { UsersSettings } from './users'

export function SettingsPage() {
  return (
    <Page>
      <PageHeader icon={SettingsIcon} title="Settings" subtitle="Application, accounts, backup and system administration." />
      <Tabs defaultValue="general">
        <TabsList className="mb-6">
          <TabsTrigger value="general">
            <Cog /> General & match
          </TabsTrigger>
          <TabsTrigger value="users">
            <Users /> Users & access
          </TabsTrigger>
          <TabsTrigger value="backup">
            <DatabaseBackup /> Backup & restore
          </TabsTrigger>
          <TabsTrigger value="system">
            <Info /> System & audit
          </TabsTrigger>
        </TabsList>
        <TabsContent value="general">
          <GeneralSettings />
        </TabsContent>
        <TabsContent value="users">
          <UsersSettings />
        </TabsContent>
        <TabsContent value="backup">
          <BackupSettings />
        </TabsContent>
        <TabsContent value="system">
          <SystemSettings />
        </TabsContent>
      </Tabs>
    </Page>
  )
}
