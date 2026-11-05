import { useState } from 'react'
import { KeyRound, Plus, UserCog } from 'lucide-react'
import { ROLES, type Role } from '@shared/domain/constants'
import type { UserDTO } from '@shared/dto'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input, Select } from '@/components/ui/input'
import { EmptyState, Panel, PanelHeader, Spinner } from '@/components/ui/misc'
import { Switch } from '@/components/ui/switch'
import { fmtDateTime } from '@/lib/format'
import { useApi, useApiMutation } from '@/lib/query'
import { useSession } from '@/lib/session'

const ROLE_INFO: Record<Role, string> = {
  admin: 'Full access including users, settings and restore',
  operator: 'Manage teams, players, matches and operate live matches',
  viewer: 'Read-only access to data and reports'
}

export function UsersSettings() {
  const { can, user: me } = useSession()
  const users = useApi('users.list', undefined, { enabled: can('admin') })
  const [editing, setEditing] = useState<UserDTO | 'new' | null>(null)

  if (!can('admin')) {
    return (
      <div className="space-y-5">
        <ChangePassword />
        <p className="text-sm text-muted">Only administrators can manage user accounts.</p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <Panel>
        <PanelHeader
          title="User accounts"
          subtitle="Local accounts. No internet login is ever required."
          actions={
            <Button size="sm" onClick={() => setEditing('new')}>
              <Plus /> Add user
            </Button>
          }
        />
        {users.isLoading ? (
          <Spinner />
        ) : !users.data?.length ? (
          <EmptyState icon={UserCog} title="No users" />
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-[11px] uppercase tracking-wider text-faint">
              <tr className="border-b border-border">
                <th className="px-5 py-2.5 font-semibold">Name</th>
                <th className="px-5 py-2.5 font-semibold">Username</th>
                <th className="px-5 py-2.5 font-semibold">Role</th>
                <th className="px-5 py-2.5 font-semibold">Last sign-in</th>
                <th className="px-5 py-2.5 font-semibold">Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users.data.map((u) => (
                <tr key={u.id} className="border-b border-border/60 last:border-0 hover:bg-surface-2/60">
                  <td className="px-5 py-3 font-medium">
                    {u.displayName} {u.id === me?.id && <span className="text-xs text-faint">(you)</span>}
                  </td>
                  <td className="px-5 py-3 text-muted">{u.username}</td>
                  <td className="px-5 py-3">
                    <Badge tone={u.role === 'admin' ? 'gold' : u.role === 'operator' ? 'primary' : 'neutral'}>{u.role}</Badge>
                  </td>
                  <td className="px-5 py-3 text-muted">{fmtDateTime(u.lastLoginAt)}</td>
                  <td className="px-5 py-3">{u.active ? <Badge tone="success">Active</Badge> : <Badge>Disabled</Badge>}</td>
                  <td className="px-5 py-3 text-right">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(u)}>
                      Edit
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
      <ChangePassword />
      {editing && <UserDialog user={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function UserDialog({ user, onClose }: { user: UserDTO | null; onClose: () => void }) {
  const [form, setForm] = useState({
    username: user?.username ?? '',
    displayName: user?.displayName ?? '',
    role: (user?.role ?? 'operator') as Role,
    active: user?.active ?? true,
    password: ''
  })
  const create = useApiMutation('users.create', { invalidate: ['users.'], success: 'User created', onSuccess: onClose })
  const update = useApiMutation('users.update', { invalidate: ['users.'], success: 'User updated', onSuccess: onClose })
  const submit = () => {
    if (user) {
      update.mutate({ id: user.id, displayName: form.displayName, role: form.role, active: form.active, password: form.password || undefined })
    } else {
      create.mutate({ username: form.username, displayName: form.displayName, role: form.role, password: form.password })
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={user ? `Edit ${user.displayName}` : 'Add user'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={create.isPending || update.isPending} onClick={submit}>
            {user ? 'Save changes' : 'Create user'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Full name" htmlFor="u-dn" required>
            <Input id="u-dn" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
          </Field>
          <Field label="Username" htmlFor="u-un" required>
            <Input id="u-un" value={form.username} disabled={!!user} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          </Field>
        </div>
        <Field label="Role" htmlFor="u-role" hint={ROLE_INFO[form.role]}>
          <Select id="u-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r[0].toUpperCase() + r.slice(1)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={user ? 'New password (leave blank to keep)' : 'Password'} htmlFor="u-pw" hint="At least 8 characters with letters and numbers.">
          <Input id="u-pw" type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </Field>
        {user && <Switch label="Account active" checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} />}
      </div>
    </Dialog>
  )
}

function ChangePassword() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const change = useApiMutation('auth.changePassword', {
    success: 'Password changed',
    onSuccess: () => {
      setCurrent('')
      setNext('')
    }
  })
  return (
    <Panel>
      <PanelHeader title="Change my password" />
      <div className="flex items-end gap-3 p-5">
        <Field label="Current password" htmlFor="cp-c" className="flex-1">
          <Input id="cp-c" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </Field>
        <Field label="New password" htmlFor="cp-n" className="flex-1">
          <Input id="cp-n" type="password" value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
        <Button variant="secondary" loading={change.isPending} disabled={!current || !next} onClick={() => change.mutate({ current, next })}>
          <KeyRound /> Update
        </Button>
      </div>
    </Panel>
  )
}
