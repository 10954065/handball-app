import { useEffect } from 'react'
import { createHashRouter, Navigate, RouterProvider } from 'react-router-dom'
import { ScreenError } from '@/components/layout/screen-error'
import { Shell } from '@/components/layout/shell'
import { Spinner } from '@/components/ui/misc'
import { useApi } from '@/lib/query'
import { useSession } from '@/lib/session'
import { LoginPage, SetupPage } from '@/pages/auth'
import { DashboardPage } from '@/pages/dashboard'
import { SettingsPage } from '@/pages/settings'
import { CompetitionsPage } from '@/pages/competitions'
import { CompetitionDetailPage } from '@/pages/competitions/detail'
import { SeasonReportPage } from '@/pages/competitions/season-report'
import { MatchesPage } from '@/pages/matches'
import { MatchDetailPage } from '@/pages/matches/detail'
import { LineupsPage } from '@/pages/lineups'
import { LiveIndexPage } from '@/pages/live'
import { MatchCentrePage } from '@/pages/live/centre'
import { ScoreboardPage } from '@/pages/scoreboard'
import { HelpPage } from '@/pages/help'
import { HistoryPage } from '@/pages/history'
import { ReportsPage } from '@/pages/reports'
import { ReportDetailPage } from '@/pages/reports/detail'
import { ReportPrintPage, SeasonPrintPage } from '@/pages/reports/print'
import { StatisticsPage } from '@/pages/statistics'
import { OfficialsPage } from '@/pages/officials'
import { PlayersPage } from '@/pages/players'
import { PlayerDetailPage } from '@/pages/players/detail'
import { TeamsPage } from '@/pages/teams'
import { TeamDetailPage } from '@/pages/teams/detail'

const SECTIONS: Record<string, { path: string; element: React.ReactNode }[]> = {
  '/live': [
    { path: 'live', element: <LiveIndexPage /> },
    { path: 'live/:id', element: <MatchCentrePage /> }
  ],
  '/settings': [{ path: 'settings', element: <SettingsPage /> }],
  '/help': [{ path: 'help', element: <HelpPage /> }],
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
    { path: 'competitions/:id', element: <CompetitionDetailPage /> },
    { path: 'competitions/:id/seasons/:seasonId/report', element: <SeasonReportPage /> }
  ],
  '/statistics': [{ path: 'statistics', element: <StatisticsPage /> }],
  '/reports': [
    { path: 'reports', element: <ReportsPage /> },
    { path: 'reports/:id', element: <ReportDetailPage /> }
  ],
  '/history': [{ path: 'history', element: <HistoryPage /> }],
  '/matches': [
    { path: 'matches', element: <MatchesPage /> },
    { path: 'matches/:id', element: <MatchDetailPage /> },
    { path: 'matches/:id/lineups', element: <LineupsPage /> }
  ]
}

const router = createHashRouter([
  { path: '/scoreboard/:id', element: <ScoreboardPage />, errorElement: <ScreenError publicScreen /> },
  { path: '/print/report/:id', element: <ReportPrintPage /> },
  { path: '/print/season/:id', element: <SeasonPrintPage /> },
  {
    path: '/',
    element: <AuthGate />,
    errorElement: <ScreenError />,
    children: [
      { index: true, element: <DashboardPage /> },
      ...Object.values(SECTIONS).flat(),
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
