import { useState } from 'react'
import { FolderOpen } from 'lucide-react'
import { CAMERA_KIND_LABELS, CAMERA_KINDS, CAMERA_ROLE_LABELS, CAMERA_ROLES, type CameraDTO, type CameraKind, type CameraRole } from '@shared/vision'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input, Select } from '@/components/ui/input'
import { ErrorNote } from '@/components/ui/misc'
import { call } from '@/lib/api'
import { useApi, useApiMutation } from '@/lib/query'

const RESOLUTIONS = [
  { label: 'Camera default', width: null, height: null },
  { label: '1280 x 720', width: 1280, height: 720 },
  { label: '1920 x 1080', width: 1920, height: 1080 }
]
const FRAME_RATES = [null, 15, 25, 30]

const ADDRESS_HINT: Record<'ip' | 'phone', string> = {
  ip: 'The RTSP address from the camera\'s manual, such as rtsp://192.168.1.50:554/stream1',
  phone: 'The address the phone app shows, such as http://192.168.1.20:8080/video'
}

function PhoneSteps() {
  return (
    <ol className="mb-4 list-decimal space-y-1 rounded-lg border border-border bg-surface-2 py-3 pl-8 pr-4 text-[13px] text-muted">
      <li>Connect the phone and this computer to the same Wi-Fi network.</li>
      <li>Open a camera streaming app on the phone. HMMS does not include one, and no account is needed for it.</li>
      <li>Start the stream, then type the address the app shows into the box below.</li>
    </ol>
  )
}

export function CameraDialog({ camera, onClose }: { camera: CameraDTO | null; onClose: () => void }) {
  const [kind, setKind] = useState<CameraKind>(camera?.kind ?? 'usb')
  const [name, setName] = useState(camera?.name ?? '')
  const [source, setSource] = useState(camera?.source ?? '')
  const [role, setRole] = useState<CameraRole>(camera?.role ?? 'main')
  const [username, setUsername] = useState(camera?.username ?? '')
  const [password, setPassword] = useState('')
  const [resolution, setResolution] = useState(Math.max(0, RESOLUTIONS.findIndex((r) => r.width === (camera?.width ?? null))))
  const [fps, setFps] = useState<number | null>(camera?.fps ?? null)
  const usb = useApi('vision.discover', undefined, { enabled: kind === 'usb', staleTime: 0 })
  const options = { invalidate: ['cameras.'], success: 'Camera saved', onSuccess: onClose, toastError: false }
  const create = useApiMutation('cameras.create', options)
  const update = useApiMutation('cameras.update', options)
  const error = create.error ?? update.error
  const network = kind === 'ip' || kind === 'phone'

  const chooseVideo = async () => {
    const file = await call('cameras.chooseVideo')
    if (file) setSource(file.path)
  }

  const save = () => {
    const { width, height } = RESOLUTIONS[resolution]
    const fields = { name, kind, source, role, username: network ? username || null : null, width, height, fps }
    if (camera) update.mutate({ ...fields, id: camera.id, password: password || undefined })
    else create.mutate({ ...fields, password: password || undefined })
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={camera ? 'Edit camera' : 'Add a camera'}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={!name.trim() || !source.trim()} loading={create.isPending || update.isPending} onClick={save}>Save camera</Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-4">
        <Field label="Type of camera" htmlFor="cam-kind">
          <Select id="cam-kind" value={kind} disabled={!!camera} onChange={(e) => { setKind(e.target.value as CameraKind); setSource('') }}>
            {CAMERA_KINDS.map((k) => <option key={k} value={k}>{CAMERA_KIND_LABELS[k]}</option>)}
          </Select>
        </Field>
        <Field label="Position" htmlFor="cam-role">
          <Select id="cam-role" value={role} onChange={(e) => setRole(e.target.value as CameraRole)}>
            {CAMERA_ROLES.map((r) => <option key={r} value={r}>{CAMERA_ROLE_LABELS[r]}</option>)}
          </Select>
        </Field>
        <Field label="Name" htmlFor="cam-name" required className="col-span-2">
          <Input id="cam-name" maxLength={60} placeholder="Main stand" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>

        {kind === 'usb' && (
          <Field label="Camera" htmlFor="cam-usb" required className="col-span-2">
            <Select id="cam-usb" value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="">{usb.isLoading ? 'Looking for cameras' : 'Choose a camera'}</option>
              {camera && !usb.data?.some((d) => d.name === source) && <option value={source}>{source} (not connected)</option>}
              {usb.data?.map((d) => <option key={d.index} value={d.name}>{d.name}</option>)}
            </Select>
          </Field>
        )}
        {usb.error && kind === 'usb' && <div className="col-span-2"><ErrorNote error={usb.error} /></div>}

        {kind === 'file' && (
          <Field label="Video file" htmlFor="cam-file" required className="col-span-2">
            <div className="flex gap-2">
              <Input id="cam-file" readOnly value={source} placeholder="No file chosen" />
              <Button variant="secondary" onClick={() => void chooseVideo()}><FolderOpen /> Choose</Button>
            </div>
          </Field>
        )}

        {network && (
          <div className="col-span-2">
            {kind === 'phone' && <PhoneSteps />}
            <Field label="Stream address" htmlFor="cam-url" required hint={ADDRESS_HINT[kind]}>
              <Input id="cam-url" value={source} onChange={(e) => setSource(e.target.value)} />
            </Field>
          </div>
        )}
        {network && (
          <>
            <Field label="Username" htmlFor="cam-user">
              <Input id="cam-user" autoComplete="off" value={username} onChange={(e) => setUsername(e.target.value)} />
            </Field>
            <Field label={camera?.hasPassword ? 'New password (leave blank to keep)' : 'Password'} htmlFor="cam-pass">
              <Input id="cam-pass" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
          </>
        )}

        {kind !== 'file' && (
          <>
            <Field label="Resolution" htmlFor="cam-res">
              <Select id="cam-res" value={resolution} onChange={(e) => setResolution(Number(e.target.value))}>
                {RESOLUTIONS.map((r, i) => <option key={r.label} value={i}>{r.label}</option>)}
              </Select>
            </Field>
            <Field label="Frame rate" htmlFor="cam-fps">
              <Select id="cam-fps" value={fps ?? ''} onChange={(e) => setFps(e.target.value ? Number(e.target.value) : null)}>
                {FRAME_RATES.map((f) => <option key={f ?? 'default'} value={f ?? ''}>{f ? `${f} frames a second` : 'Camera default'}</option>)}
              </Select>
            </Field>
          </>
        )}
      </div>
      {!!error && <div className="mt-3"><ErrorNote error={error} /></div>}
    </Dialog>
  )
}
