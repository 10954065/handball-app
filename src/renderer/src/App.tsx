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

const IMPLEMENTED: Record<string, React.ReactNode> = {
  '/settings': <SettingsPage />
}

const router = createHashRouter([
  {
    path: '/',
    element: <AuthGate />,
    children: [
      { index: true, element: <DashboardPage /> },
      ...NAV.filter((n) => n.to !== '/').map((n) => ({
        path: n.to.slice(1) + '/*',
        element: n.phase <= BUILD_PHASE && IMPLEMENTED[n.to] ? IMPLEMENTED[n.to] : <NotAvailablePage item={n} />
      })),
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
