import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cameraDevices } from '../../src/main/db/schema'
import { listAudit } from '../../src/main/services/audit'
import { cameraSpec, createCamera, deleteCamera, listCameras, updateCamera, type Secrets } from '../../src/main/services/cameras'
import { CameraFeeds } from '../../src/main/vision/feeds'
import { cameraInputSchema, cameraUpdateSchema } from '../../src/shared/schemas/vision'
import type { CameraFeedDTO } from '../../src/shared/vision'
import { testDb, type TestDb } from './helpers'

/** Reversible and visibly different from the input, as the real encryption is. */
const secrets: Secrets = {
  available: () => true,
  encrypt: (text) => `sealed:${Buffer.from(text).toString('hex')}`,
  decrypt: (text) => {
    if (!text.startsWith('sealed:')) throw new Error('wrong key')
    return Buffer.from(text.slice(7), 'hex').toString()
  }
}

const ip = cameraInputSchema.parse({ name: 'Main stand', kind: 'ip', source: 'rtsp://10.0.0.5:554/live', username: 'kofi', password: "p@ss w/rd'", role: 'main' })
const usb = cameraInputSchema.parse({ name: 'Goal camera', kind: 'usb', source: 'OBS Virtual Camera', role: 'goal', width: 1280, height: 720, fps: 30 })

let t: TestDb
beforeEach(() => {
  t = testDb(true)
})
afterEach(() => t.cleanup())

const rawRow = (id: string) => t.handle.db.select().from(cameraDevices).all().find((c) => c.id === id)!

describe('validating a camera', () => {
  const parse = (over: object) => cameraInputSchema.safeParse({ name: 'x', kind: 'ip', source: 'rtsp://10.0.0.5/live', role: 'main', ...over }).success

  it('accepts the addresses cameras and phone apps use', () => {
    expect(parse({ source: 'rtsp://10.0.0.5:554/h264' })).toBe(true)
    expect(parse({ kind: 'phone', source: 'http://192.168.1.20:8080/video' })).toBe(true)
    expect(parse({ source: 'rtsps://cam.local/live' })).toBe(true)
  })

  it('refuses anything else as a stream address', () => {
    expect(parse({ source: 'file:///C:/Windows/win.ini' })).toBe(false)
    expect(parse({ source: 'not an address' })).toBe(false)
    expect(parse({ source: 'javascript:alert(1)' })).toBe(false)
  })

  it('refuses a password inside the address, which would be stored and logged as plain text', () => {
    expect(parse({ source: 'rtsp://kofi:secret@10.0.0.5/live' })).toBe(false)
  })

  it('refuses a resolution or frame rate outside what a camera can do', () => {
    expect(parse({ fps: 0 })).toBe(false)
    expect(parse({ fps: 500 })).toBe(false)
    expect(parse({ width: 99_999 })).toBe(false)
  })

  it('needs a full path for a video file', () => {
    expect(parse({ kind: 'file', source: 'clip.mp4' })).toBe(false)
    expect(parse({ kind: 'file', source: 'E:\\Matches\\final.mp4' })).toBe(true)
  })
})

describe('saving a camera', () => {
  it('stores the password encrypted, and never returns it', () => {
    const cam = createCamera(t.ctx(), secrets, ip)
    expect(rawRow(cam.id).passwordEncrypted).toMatch(/^sealed:/)
    expect(JSON.stringify(rawRow(cam.id))).not.toContain('p@ss')
    expect(cam).toMatchObject({ hasPassword: true, username: 'kofi' })
    expect(JSON.stringify(listCameras(t.ctx()))).not.toContain('sealed')
  })

  it('refuses to store a password if Windows cannot encrypt it', () => {
    expect(() => createCamera(t.ctx(), { ...secrets, available: () => false }, ip)).toThrow(/cannot protect/)
    expect(listCameras(t.ctx())).toEqual([])
  })

  it('saves a camera with no password even when encryption is unavailable', () => {
    expect(createCamera(t.ctx(), { ...secrets, available: () => false }, usb).hasPassword).toBe(false)
  })

  it('keeps the password out of the audit log', () => {
    createCamera(t.ctx(), secrets, ip)
    const log = JSON.stringify(listAudit(t.ctx(), { limit: 10, offset: 0 }))
    expect(log).toContain('camera.create')
    expect(log).not.toContain('p@ss')
    expect(log).not.toContain('sealed')
  })

  it('keeps the password when an edit leaves it out', () => {
    const cam = createCamera(t.ctx(), secrets, ip)
    updateCamera(t.ctx(), secrets, cameraUpdateSchema.parse({ ...ip, id: cam.id, password: undefined, name: 'Renamed' }))
    expect(rawRow(cam.id).passwordEncrypted).toMatch(/^sealed:/)
    expect(listCameras(t.ctx())[0].name).toBe('Renamed')
  })

  it('removes the password when asked', () => {
    const cam = createCamera(t.ctx(), secrets, ip)
    updateCamera(t.ctx(), secrets, cameraUpdateSchema.parse({ ...ip, id: cam.id, password: null }))
    expect(rawRow(cam.id).passwordEncrypted).toBeNull()
  })

  it('deletes a camera', () => {
    const cam = createCamera(t.ctx(), secrets, usb)
    deleteCamera(t.ctx(), cam.id)
    expect(listCameras(t.ctx())).toEqual([])
    expect(() => deleteCamera(t.ctx(), cam.id)).toThrow()
  })
})

describe('preparing a camera to open', () => {
  const devices = [{ index: 0, name: 'Iriun Webcam' }, { index: 11, name: 'OBS Virtual Camera' }]

  it('finds a USB camera by name, whatever number Windows gave it today', () => {
    const cam = createCamera(t.ctx(), secrets, usb)
    expect(cameraSpec(t.ctx(), secrets, cam.id, devices)).toEqual({ id: cam.id, kind: 'usb', source: 11, width: 1280, height: 720, fps: 30 })
  })

  it('says which camera is missing', () => {
    const cam = createCamera(t.ctx(), secrets, usb)
    expect(() => cameraSpec(t.ctx(), secrets, cam.id, [])).toThrow(/OBS Virtual Camera is not connected/)
  })

  it('adds the credentials to the address only at the moment of opening, safely encoded', () => {
    const cam = createCamera(t.ctx(), secrets, ip)
    expect(cameraSpec(t.ctx(), secrets, cam.id, devices).source).toBe("rtsp://kofi:p%40ss%20w%2Frd'@10.0.0.5:554/live")
  })

  it('asks for the password again on a different Windows account', () => {
    const cam = createCamera(t.ctx(), secrets, ip)
    const other: Secrets = { ...secrets, decrypt: () => { throw new Error('wrong key') } }
    expect(() => cameraSpec(t.ctx(), other, cam.id, devices)).toThrow(/Enter the camera password again/)
  })

  it('opens a video file directly', () => {
    const cam = createCamera(t.ctx(), secrets, cameraInputSchema.parse({ name: 'Final', kind: 'file', source: 'E:\\final.mp4', role: 'main' }))
    expect(cameraSpec(t.ctx(), secrets, cam.id, devices)).toMatchObject({ kind: 'file', source: 'E:\\final.mp4' })
  })

  it('treats a phone as a network camera', () => {
    const cam = createCamera(t.ctx(), secrets, cameraInputSchema.parse({ name: 'Phone', kind: 'phone', source: 'http://192.168.1.20:8080/video', role: 'sideline' }))
    expect(cameraSpec(t.ctx(), secrets, cam.id, devices)).toMatchObject({ kind: 'network', source: 'http://192.168.1.20:8080/video' })
  })
})

describe('camera feeds', () => {
  const ID = '11111111-1111-4111-8111-111111111111'
  const spec = { id: ID, kind: 'usb' as const, source: 0, width: null, height: null, fps: null }

  function make() {
    const send = vi.fn(async () => ({}))
    const changes: CameraFeedDTO[][] = []
    return { feeds: new CameraFeeds(send, (s) => changes.push(s)), send, changes }
  }

  it('shows a camera as connecting as soon as it is opened', async () => {
    const { feeds, send } = make()
    await feeds.open(spec)
    expect(send).toHaveBeenCalledWith('camera.open', spec)
    expect(feeds.states()).toEqual([expect.objectContaining({ id: ID, state: 'connecting' })])
  })

  it('hears from a quick camera that goes live before the open request is answered', async () => {
    const { feeds, send } = make()
    send.mockImplementationOnce(async () => {
      feeds.onEvent({ type: 'camera', camera: ID, state: 'live', message: null, width: 64, height: 48 }, Buffer.alloc(0))
      return {}
    })
    await feeds.open(spec)
    expect(feeds.states()[0].state).toBe('live')
  })

  it('keeps only the newest picture for each camera', async () => {
    const { feeds } = make()
    await feeds.open(spec)
    feeds.onEvent({ type: 'frame', camera: ID, seq: 1, width: 64, height: 48 }, Buffer.from('one'))
    feeds.onEvent({ type: 'frame', camera: ID, seq: 2, width: 64, height: 48 }, Buffer.from('two'))
    expect(feeds.latest(ID)?.toString()).toBe('two')
  })

  it('follows state changes and their messages', async () => {
    const { feeds, changes } = make()
    await feeds.open(spec)
    feeds.onEvent({ type: 'camera', camera: ID, state: 'live', message: null, width: 1920, height: 1080 }, Buffer.alloc(0))
    feeds.onEvent({ type: 'camera', camera: ID, state: 'reconnecting', message: 'The camera stopped sending pictures.' }, Buffer.alloc(0))
    expect(changes.at(-1)?.[0]).toMatchObject({ state: 'reconnecting', message: 'The camera stopped sending pictures.', width: 1920 })
  })

  it('ignores messages about cameras nobody opened, and malformed ones', async () => {
    const { feeds } = make()
    feeds.onEvent({ type: 'frame', camera: ID, seq: 1, width: 1, height: 1 }, Buffer.from('x'))
    feeds.onEvent({ type: 'camera', camera: 42 }, Buffer.alloc(0))
    feeds.onEvent({ type: 'something new' }, Buffer.alloc(0))
    expect(feeds.states()).toEqual([])
    expect(feeds.latest(ID)).toBeNull()
  })

  it('forgets a closed camera and its picture', async () => {
    const { feeds, send } = make()
    await feeds.open(spec)
    feeds.onEvent({ type: 'frame', camera: ID, seq: 1, width: 1, height: 1 }, Buffer.from('x'))
    await feeds.close(ID)
    expect(send).toHaveBeenCalledWith('camera.close', { id: ID })
    expect(feeds.latest(ID)).toBeNull()
    expect(feeds.states()).toEqual([])
  })

  it('reopens every camera after the service restarts', async () => {
    const { feeds, send } = make()
    await feeds.open(spec)
    feeds.onServiceState('restarting')
    expect(feeds.states()[0].state).toBe('reconnecting')
    send.mockClear()
    feeds.onServiceState('running')
    expect(send).toHaveBeenCalledWith('camera.open', spec)
  })

  it('does not reopen anything when the service first starts', () => {
    const { feeds, send } = make()
    feeds.onServiceState('running')
    expect(send).not.toHaveBeenCalled()
  })

  it('clears everything when the service stops for good', async () => {
    const { feeds } = make()
    await feeds.open(spec)
    feeds.onEvent({ type: 'frame', camera: ID, seq: 1, width: 1, height: 1 }, Buffer.from('x'))
    feeds.onServiceState('failed')
    expect(feeds.states()).toEqual([])
    expect(feeds.latest(ID)).toBeNull()
  })

  it('does not offer a picture from a camera that lost its connection long ago', async () => {
    const { feeds } = make()
    await feeds.open(spec)
    feeds.onEvent({ type: 'frame', camera: ID, seq: 1, width: 1, height: 1 }, Buffer.from('x'))
    feeds.onEvent({ type: 'camera', camera: ID, state: 'failed', message: 'This video file cannot be read.' }, Buffer.alloc(0))
    expect(feeds.states()[0].state).toBe('failed')
    expect(feeds.latest(ID)).toBeNull()
  })

  it('reports a camera the service refused', async () => {
    const { feeds, send } = make()
    send.mockRejectedValueOnce(new Error('Up to 3 cameras can run at once. Close one first.'))
    await expect(feeds.open(spec)).rejects.toThrow(/Up to 3/)
    expect(feeds.states()).toEqual([])
  })
})
