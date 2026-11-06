import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { ChevronsLeft, ChevronsRight, FlaskConical, LogOut } from 'lucide-react'
import { call } from '@/lib/api'
import { cn } from '@/lib/cn'
import { NAV } from '@/lib/nav'
import { useApi } from '@/lib/query'
import { useSession } from '@/lib/session'
import { initials } from '@/lib/format'
import { BrandWordmark } from './brand'

const COLLAPSE_KEY = 'hmms.sidebar.collapsed'

export function Shell() {
  const { user, status } = useSession()
  const navigate = useNavigate()
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === '1')
  useEffect(() => localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0'), [collapsed])
  const demo = status?.mode === 'demo'
  const liveMatches = useApi('matches.list', { status: ['live'], limit: 1 })

  return (
    <div className="flex h-full flex-col">
      {demo && (
        <div className="flex h-8 shrink-0 items-center justify-center gap-2 bg-gold text-[12px] font-bold uppercase tracking-[0.18em] text-black">
          <FlaskConical className="size-3.5" />
          Demonstration mode - sample data only, separate from the production database
          <button className="ml-3 rounded bg-black/15 px-2 py-0.5 tracking-normal hover:bg-black/25" onClick={() => void call('demo.exit')}>
            Exit demo
          </button>
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <aside
          className={cn(
            'flex shrink-0 flex-col border-r border-border bg-surface-1 transition-[width] duration-200',
            collapsed ? 'w-[72px]' : 'w-[248px]'
          )}
        >
          <div className={cn('flex h-16 items-center border-b border-border', collapsed ? 'justify-center' : 'px-4')}>
            <BrandWordmark collapsed={collapsed} />
          </div>
          <nav className="flex-1 space-y-0.5 overflow-y-auto p-2.5" aria-label="Primary">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                title={collapsed ? item.label : undefined}
                className={({ isActive }) =>
                  cn(
                    'group relative flex h-10 items-center gap-3 rounded-md text-[13.5px] font-medium transition-colors',
                    collapsed ? 'justify-center' : 'px-3',
                    isActive ? 'bg-primary/14 text-text' : 'text-muted hover:bg-surface-2 hover:text-text'
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r bg-primary" />}
                    <item.icon className={cn('size-[18px] shrink-0', isActive && 'text-primary')} />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                    {!collapsed && item.to === '/live' && !!liveMatches.data?.length && (
                      <span data-testid="live-indicator" title="A match is live" className="ml-auto size-2 rounded-full bg-red-card shadow-[0_0_8px] shadow-red-card" />
                    )}
                  </>
                )}
              </NavLink>
            ))}
          </nav>
          <div className="border-t border-border p-2.5">
            {user && !collapsed && (
              <div className="mb-2 flex items-center gap-3 rounded-md px-2 py-2">
                <div className="grid size-8 place-items-center rounded-full bg-surface-3 text-xs font-semibold">{initials(user.displayName)}</div>
                <div className="min-w-0 flex-1 leading-tight">
                  <div className="truncate text-[13px] font-medium">{user.displayName}</div>
                  <div className="text-[11px] capitalize text-faint">{user.role}</div>
                </div>
                <button
                  className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-text"
                  title="Sign out"
                  aria-label="Sign out"
                  onClick={async () => {
                    await call('auth.logout')
                    navigate('/')
                  }}
                >
                  <LogOut className="size-4" />
                </button>
              </div>
            )}
            <button
              onClick={() => setCollapsed((c) => !c)}
              className="flex h-9 w-full items-center justify-center gap-2 rounded-md text-xs text-faint hover:bg-surface-2 hover:text-text"
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {collapsed ? <ChevronsRight className="size-4" /> : <ChevronsLeft className="size-4" />}
              {!collapsed && 'Collapse'}
            </button>
          </div>
        </aside>
        <main className="min-w-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

export function Page({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return <div className={cn('mx-auto w-full px-8 py-7', wide ? 'max-w-[1800px]' : 'max-w-[1440px]')}>{children}</div>
}
