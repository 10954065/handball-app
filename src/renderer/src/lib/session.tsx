import { createContext, useContext, useEffect, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { AuthStatus, SessionUser } from '@shared/dto'
import type { Permission } from '@shared/domain/constants'
import { subscribe } from './api'
import { useApi } from './query'

interface SessionValue {
  status: AuthStatus | undefined
  user: SessionUser | null
  isLoading: boolean
  can: (p: Permission) => boolean
}

const SessionCtx = createContext<SessionValue | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const status = useApi('auth.status')

  useEffect(() => {
    const offSession = subscribe('session.changed', () => void qc.invalidateQueries())
    const offData = subscribe('data.reloaded', () => void qc.invalidateQueries())
    const offSettings = subscribe('settings.changed', (s) => qc.setQueryData(['settings.get', null], s))
    return () => {
      offSession()
      offData()
      offSettings()
    }
  }, [qc])

  const user = status.data?.user ?? null
  const value: SessionValue = {
    status: status.data,
    user,
    isLoading: status.isLoading,
    can: (p) => !!user && user.permissions.includes(p)
  }
  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>
}

export function useSession(): SessionValue {
  const v = useContext(SessionCtx)
  if (!v) throw new Error('useSession outside SessionProvider')
  return v
}
