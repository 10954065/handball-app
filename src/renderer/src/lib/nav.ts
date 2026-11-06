import {
  BarChart3,
  CalendarDays,
  FileText,
  History,
  LayoutDashboard,
  LifeBuoy,
  RadioTower,
  ScanEye,
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
}

export const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/live', label: 'Live Match Centre', icon: RadioTower },
  { to: '/vision', label: 'AI Vision', icon: ScanEye },
  { to: '/matches', label: 'Matches', icon: CalendarDays },
  { to: '/competitions', label: 'Competitions', icon: Trophy },
  { to: '/teams', label: 'Teams', icon: Shield },
  { to: '/players', label: 'Players', icon: Shirt },
  { to: '/officials', label: 'Officials', icon: Users },
  { to: '/statistics', label: 'Statistics', icon: BarChart3 },
  { to: '/reports', label: 'Match Reports', icon: FileText },
  { to: '/history', label: 'Match History', icon: History },
  { to: '/settings', label: 'Settings', icon: Settings },
  { to: '/help', label: 'Help & guides', icon: LifeBuoy }
]
