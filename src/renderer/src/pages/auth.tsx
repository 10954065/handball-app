import { useState, type FormEvent, type ReactNode } from 'react'
import { FlaskConical, KeyRound, ShieldCheck } from 'lucide-react'
import { setupSchema } from '@shared/schemas/auth'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { BrandMark } from '@/components/layout/brand'
import { call, errorMessage } from '@/lib/api'

function AuthFrame({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="relative grid h-full place-items-center overflow-hidden bg-bg">
      <div className="pointer-events-none absolute inset-0 opacity-[0.07]" aria-hidden>
        <svg className="h-full w-full" viewBox="0 0 400 200" preserveAspectRatio="xMidYMid slice">
          <rect x="10" y="10" width="380" height="180" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <line x1="200" y1="10" x2="200" y2="190" stroke="currentColor" strokeWidth="1.5" />
          <path d="M10 40 a60 60 0 0 1 0 120" fill="none" stroke="currentColor" strokeWidth="1.5" transform="translate(0,0)" />
          <path d="M10 25 a75 75 0 0 1 0 150" fill="none" stroke="currentColor" strokeDasharray="4 4" />
          <path d="M390 40 a60 60 0 0 0 0 120" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M390 25 a75 75 0 0 0 0 150" fill="none" stroke="currentColor" strokeDasharray="4 4" />
          <circle cx="200" cy="100" r="2" fill="currentColor" />
        </svg>
      </div>
      <div className="relative w-[440px] rounded-2xl border border-border bg-surface-1/95 p-9 shadow-2xl shadow-black/40">
        <div className="mb-7 flex items-center gap-3.5">
          <BrandMark className="size-12" />
          <div>
            <div className="font-display text-2xl font-bold tracking-[0.12em]">HMMS</div>
            <div className="text-xs text-muted">Handball Match Management System</div>
          </div>
        </div>
        <h1 className="font-display text-2xl font-semibold tracking-wide">{title}</h1>
        <p className="mt-1 mb-6 text-sm text-muted">{subtitle}</p>
        {children}
      </div>
    </div>
  )
}

export function SetupPage() {
  const [form, setForm] = useState({ organisationName: '', displayName: '', username: '', password: '', confirm: '' })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value })

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setFormError(null)
    const parsed = setupSchema.safeParse(form)
    const errs: Record<string, string> = {}
    if (!parsed.success) for (const i of parsed.error.issues) errs[String(i.path[0])] ??= i.message
    if (form.password !== form.confirm) errs.confirm = 'Passwords do not match'
    if (!/[A-Za-z]/.test(form.password) || !/[0-9]/.test(form.password)) errs.password ??= 'Use letters and numbers'
    setErrors(errs)
    if (Object.keys(errs).length) return
    setBusy(true)
    try {
      await call('auth.setup', { username: form.username, displayName: form.displayName, password: form.password, organisationName: form.organisationName })
    } catch (err) {
      setFormError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthFrame title="Welcome - first-run setup" subtitle="Create the administrator account for this computer. All data stays on this machine.">
      <form className="space-y-4" onSubmit={submit} noValidate>
        <Field label="Association / organisation" htmlFor="org" hint="Shown on match reports. Optional.">
          <Input id="org" value={form.organisationName} onChange={set('organisationName')} placeholder="e.g. Handball Association of Ghana" />
        </Field>
        <Field label="Your full name" htmlFor="dn" error={errors.displayName} required>
          <Input id="dn" value={form.displayName} onChange={set('displayName')} autoFocus />
        </Field>
        <Field label="Username" htmlFor="un" error={errors.username} required>
          <Input id="un" value={form.username} onChange={set('username')} autoComplete="username" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Password" htmlFor="pw" error={errors.password} required>
            <Input id="pw" type="password" value={form.password} onChange={set('password')} autoComplete="new-password" />
          </Field>
          <Field label="Confirm" htmlFor="pw2" error={errors.confirm} required>
            <Input id="pw2" type="password" value={form.confirm} onChange={set('confirm')} autoComplete="new-password" />
          </Field>
        </div>
        {formError && <p className="text-sm text-danger">{formError}</p>}
        <Button type="submit" size="lg" className="w-full" loading={busy}>
          <ShieldCheck /> Create administrator
        </Button>
      </form>
      <DemoLink />
    </AuthFrame>
  )
}

export function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await call('auth.login', { username, password })
    } catch (err) {
      setError(errorMessage(err))
      setPassword('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthFrame title="Sign in" subtitle="Sign in with your local HMMS account.">
      <form className="space-y-4" onSubmit={submit}>
        <Field label="Username" htmlFor="u">
          <Input id="u" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus autoComplete="username" />
        </Field>
        <Field label="Password" htmlFor="p">
          <Input id="p" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </Field>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" className="w-full" loading={busy} disabled={!username || !password}>
          <KeyRound /> Sign in
        </Button>
      </form>
      <DemoLink />
    </AuthFrame>
  )
}

function DemoLink() {
  const [busy, setBusy] = useState(false)
  return (
    <div className="mt-6 border-t border-border pt-5 text-center">
      <button
        className="inline-flex items-center gap-2 text-sm text-muted hover:text-gold disabled:opacity-50"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          try {
            await call('demo.enter')
          } finally {
            setBusy(false)
          }
        }}
      >
        <FlaskConical className="size-4" /> Explore demonstration mode (separate sample database)
      </button>
    </div>
  )
}
