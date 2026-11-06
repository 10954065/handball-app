import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { CircleHelp, ClipboardList, LifeBuoy, ShieldCheck, type LucideIcon } from 'lucide-react'
import { Page } from '@/components/layout/shell'
import { PageHeader, Panel } from '@/components/ui/misc'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import adminGuide from '../../../../../docs/ADMIN_GUIDE.md?raw'
import operatorGuide from '../../../../../docs/OPERATOR_GUIDE.md?raw'
import userGuide from '../../../../../docs/USER_GUIDE.md?raw'
import '@/styles/guide.css'

const GUIDES: { id: string; label: string; icon: LucideIcon; text: string }[] = [
  { id: 'user', label: 'User guide', icon: CircleHelp, text: userGuide },
  { id: 'operator', label: 'Match operator', icon: ClipboardList, text: operatorGuide },
  { id: 'admin', label: 'Administrator', icon: ShieldCheck, text: adminGuide }
]

/** The guides are compiled into the application, so they are there with no internet connection. */
export function HelpPage() {
  return (
    <Page>
      <PageHeader icon={LifeBuoy} title="Help & guides" subtitle="How to use HMMS. These guides work offline." />
      <Tabs defaultValue="user">
        <TabsList className="mb-6">
          {GUIDES.map((g) => (
            <TabsTrigger key={g.id} value={g.id}>
              <g.icon /> {g.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {GUIDES.map((g) => (
          <TabsContent key={g.id} value={g.id}>
            <Panel className="px-8 py-6">
              <article className="guide">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{g.text}</ReactMarkdown>
              </article>
            </Panel>
          </TabsContent>
        ))}
      </Tabs>
    </Page>
  )
}
