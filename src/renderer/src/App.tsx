import { useEffect } from 'react'
import { createHashRouter, Navigate, RouterProvider } from 'react-router-dom'
import { Shell } from '@/components/layout/shell'
import { Spinner } from '@/components/ui/misc'
import { useApi } from '@/lib/query'
import { BUILD_PHASE, NAV } from '@/lib/nav'
import { useSession } from '@/lib/session'
import { LoginPage, SetupPage } from '@/pages/auth'
import { DashboardPage } from '@/pages/dashboard'
import { NotAvailablePage } from '@/pages/not-available'
import { SettingsPage } from '@/pages/settings'
import { CompetitionsPage } from '@/pages/competitions'
import { CompetitionDetailPage } from '@/pages/competitions/detail'
import { MatchesPage } from '@/pages/matches'
import { MatchDetailPage } from '@/pages/matches/detail'
import { LineupsPage } from '@/pages/lineups'
import { OfficialsPage } from '@/pages/officials'
import { PlayersPage } from '@/pages/players'
import { PlayerDetailPage } from '@/pages/players/detail'
import { TeamsPage } from '@/pages/teams'
import { TeamDetailPage } from '@/pages/teams/detail'

/** Routes per navigation section. Sections without an entry are not part of this build yet. */
const IMPLEMENTED: Record<string, { path: string; element: React.ReactNode }[]> = {
  '/settings': [{ path: 'settings', element: <SettingsPage /> }],
  '/teams': [
    { path: 'teams', element: <TeamsPage /> },
    { path: 'teams/:id', element: <TeamDetailPage /> }
  ],
  '/players': [
    { path: 'players', element: <PlayersPage /> },
    { path: 'players/:id', element: <PlayerDetailPage /> }
  ],
  '/officials': [{ path: 'officials', element: <OfficialsPage /> }],
  '/competitions': [
    { path: 'competitions', element: <CompetitionsPage /> },
    { path: 'competitions/:id', element: <CompetitionDetailPage /> }
  ],
  '/matches': [
    { path: 'matches', element: <MatchesPage /> },
    { path: 'matches/:id', element: <MatchDetailPage /> },
    { path: 'matches/:id/lineups', element: <LineupsPage /> }
  ]
}

const router = createHashRouter([
  {
    path: '/',
    element: <AuthGate />,
    children: [
      { index: true, element: <DashboardPage /> },
      ...NAV.filter((n) => n.to !== '/').flatMap((n) =>
        n.phase <= BUILD_PHASE && IMPLEMENTED[n.to] ? IMPLEMENTED[n.to] : [{ path: n.to.slice(1) + '/*', element: <NotAvailablePage item={n} /> }]
      ),
      { path: '*', element: <Navigate to="/" replace /> }
    ]
  }
])

function AuthGate() {
  const { status, isLoading, user } = useSession()
  if (isLoading || !status) return <Spinner label="Starting HMMS" className="h-full" />
  if (status.needsSetup) return <SetupPage />
  if (!user) return <LoginPage />
  return <Shell />
}

function useThemeFromSettings() {
  const settings = useApi('settings.get')
  const theme = settings.data?.display.theme ?? 'dark'
  useEffect(() => {
    const apply = () => {
      const resolved = theme === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : theme
      document.documentElement.dataset.theme = resolved
    }
    apply()
    const mq = matchMedia('(prefers-color-scheme: light)')
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [theme])
}

export function App() {
  useThemeFromSettings()
  return <RouterProvider router={router} />
}
