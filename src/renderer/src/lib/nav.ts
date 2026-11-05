import {
  BarChart3,
  CalendarDays,
  FileText,
  History,
  LayoutDashboard,
  RadioTower,
  Settings,
  Shield,
  Shirt,
  Trophy,
  Users,
  type LucideIcon
} from 'lucide-react'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  /** Development phase that delivers this module. */
  phase: number
}

export const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, phase: 1 },
  { to: '/live', label: 'Live Match Centre', icon: RadioTower, phase: 4 },
  { to: '/matches', label: 'Matches', icon: CalendarDays, phase: 2 },
  { to: '/competitions', label: 'Competitions', icon: Trophy, phase: 2 },
  { to: '/teams', label: 'Teams', icon: Shield, phase: 2 },
  { to: '/players', label: 'Players', icon: Shirt, phase: 2 },
  { to: '/officials', label: 'Officials', icon: Users, phase: 2 },
  { to: '/statistics', label: 'Statistics', icon: BarChart3, phase: 6 },
  { to: '/reports', label: 'Match Reports', icon: FileText, phase: 6 },
  { to: '/history', label: 'Match History', icon: History, phase: 6 },
  { to: '/settings', label: 'Settings', icon: Settings, phase: 1 }
]

/** The highest development phase included in this build. */
export const BUILD_PHASE = 6
