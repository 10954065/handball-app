import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FrameParser, ProtocolViolation } from '../../src/main/vision/frames'
import { VisionSupervisor, type VisionOptions } from '../../src/main/vision/supervisor'
import type { VisionStatus } from '../../src/shared/vision'

const FAKE = resolve('tests/fixtures/fake-vision.mjs')
const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined }

let supervisor: VisionSupervisor | null = null

function make(mode: string, options: Partial<VisionOptions> = {}) {
  const seen: VisionStatus[] = []
  const events: { header: Record<string, unknown>; payload: Buffer }[] = []
  supervisor = new VisionSupervisor({
    locate: () => ({ command: process.execPath, args: [FAKE, mode] }),
    onStatus: (s) => seen.push(s),
    onEvent: (header, payload) => events.push({ header, payload }),
    log: quiet,
    heartbeatMs: 40,
    startupTimeoutMs: 8000,
    requestTimeoutMs: 200,
    restartDelayMs: 10,
    ...options
  })
  return { vision: supervisor, seen, events }
}

afterEach(async () => {
  await supervisor?.stop()
  supervisor = null
})

const frame = (header: object, payload = Buffer.alloc(0)) => {
  const body = Buffer.from(JSON.stringify(header))
  const lengths = Buffer.alloc(8)
  lengths.writeUInt32LE(body.length, 0)
  lengths.writeUInt32LE(payload.length, 4)
  return Buffer.concat([lengths, body, payload])
}

describe('reading frames from the service', () => {
  it('reassembles frames however the pipe splits them', () => {
    const out: unknown[] = []
    const parser = new FrameParser((h, p) => out.push([h, p.toString()]))
    const bytes = Buffer.concat([frame({ n: 1 }, Buffer.from('abc')), frame({ n: 2 })])
    for (const byte of bytes) parser.push(Buffer.from([byte]))
    expect(out).toEqual([[{ n: 1 }, 'abc'], [{ n: 2 }, '']])
  })

  it('handles several frames in one read', () => {
    const out: unknown[] = []
    new FrameParser((h) => out.push(h)).push(Buffer.concat([frame({ n: 1 }), frame({ n: 2 }), frame({ n: 3 })]))
    expect(out).toHaveLength(3)
  })

  it('refuses a length that would exhaust memory, before allocating anything', () => {
    const lengths = Buffer.alloc(8)
    lengths.writeUInt32LE(4_000_000_000, 4)
    expect(() => new FrameParser(() => undefined).push(lengths)).toThrow(ProtocolViolation)
  })

  it('refuses a header that is not a JSON object', () => {
    const lengths = Buffer.alloc(8)
    lengths.writeUInt32LE(3, 0)
    expect(() => new FrameParser(() => undefined).push(Buffer.concat([lengths, Buffer.from('nop')]))).toThrow(ProtocolViolation)
    expect(() => new FrameParser(() => undefined).push(Buffer.concat([lengths, Buffer.from('[1]')]))).toThrow(ProtocolViolation)
  })
})

describe('running the service', () => {
  it('reports running once the service has introduced itself', async () => {
    const { vision, seen } = make('normal')
    await vision.start()
    expect(vision.status()).toMatchObject({ state: 'running', version: '0.0.1' })
    expect(seen.map((s) => s.state).slice(0, 2)).toEqual(['starting', 'running'])
  })

  it('makes a second caller wait for a start already under way', async () => {
    const { vision } = make('normal')
    await Promise.all([vision.start(), vision.start()])
    expect(vision.status().state).toBe('running')
  })

  it('makes a caller wait for an automatic restart to finish', async () => {
    const { vision, seen } = make('crash', { maxRestarts: 1 })
    await vision.start()
    await vi.waitFor(() => expect(seen.some((s) => s.state === 'restarting')).toBe(true), { timeout: 5000 })
    await vision.start()
    expect(['running', 'failed']).toContain(vision.status().state)
  })

  it('answers commands, and passes on a refusal meant for the operator', async () => {
    const { vision } = make('normal')
    await vision.start()
    await expect(vision.request('health')).resolves.toMatchObject({ cpuPercent: 1 })
    await expect(vision.request('fail')).rejects.toThrow('Camera 2 is not connected.')
  })

  it('delivers frames with their binary payload', async () => {
    const { vision, events } = make('normal')
    await vision.start()
    void vision.request('emit').catch(() => undefined)
    await vi.waitFor(() => expect(events).toHaveLength(1), { timeout: 5000 })
    expect(events[0].header).toEqual({ type: 'frame', camera: 'a' })
    expect(events[0].payload.toString()).toBe('jpeg-bytes')
  })

  it('collects health while it runs', async () => {
    const { vision } = make('normal')
    await vision.start()
    await vi.waitFor(() => expect(vision.status().health).toMatchObject({ serviceMemoryMb: 4 }), { timeout: 5000 })
  })

  it('stops cleanly and does not restart', async () => {
    const { vision } = make('normal')
    await vision.start()
    await vision.stop()
    expect(vision.status().state).toBe('stopped')
    await new Promise((r) => setTimeout(r, 60))
    expect(vision.status().state).toBe('stopped')
  })

  it('says so when the service is not installed, and never throws', async () => {
    const { vision } = make('normal', { locate: () => null })
    await vision.start()
    expect(vision.status()).toMatchObject({ state: 'not_installed' })
    expect(vision.status().message).toMatch(/not installed/)
  })

  it('refuses commands while it is not running', async () => {
    const { vision } = make('normal')
    await expect(vision.request('health')).rejects.toThrow(/not running/)
  })
})

describe('when the service misbehaves', () => {
  it('refuses a service from a different version of HMMS', async () => {
    const { vision } = make('wrong-protocol')
    await vision.start()
    expect(vision.status().state).toBe('failed')
    expect(vision.status().message).toMatch(/does not match/)
  })

  it('gives up on a service that never starts', async () => {
    const { vision } = make('silent', { maxRestarts: 0, startupTimeoutMs: 300 })
    await vision.start()
    expect(vision.status().state).toBe('failed')
  })

  it('restarts a service that crashes', async () => {
    const { vision, seen } = make('crash', { maxRestarts: 2 })
    await vision.start()
    await vi.waitFor(() => expect(seen.some((s) => s.state === 'restarting')).toBe(true), { timeout: 5000 })
  })

  it('stops trying after repeated crashes, and says what to do', async () => {
    const { vision } = make('crash', { maxRestarts: 2 })
    await vision.start()
    await vi.waitFor(() => expect(vision.status().state).toBe('failed'), { timeout: 4000 })
    expect(vision.status().message).toMatch(/keeps stopping/)
    expect(vision.status().restarts).toBe(2)
  })

  it('fails a command waiting when the service dies', async () => {
    const { vision } = make('crash', { maxRestarts: 0 })
    await vision.start()
    await expect(vision.request('no-answer-coming', {}, 2000)).rejects.toThrow()
  })

  it('treats nonsense on the pipe as a failure of the service, not of HMMS', async () => {
    const { vision } = make('garbage', { maxRestarts: 0 })
    await vision.start()
    expect(vision.status().state).toBe('failed')
  })

  it('kills and restarts a service that stops answering', async () => {
    const { vision, seen } = make('hang-later', { maxRestarts: 1, requestTimeoutMs: 60 })
    await vision.start()
    await vi.waitFor(() => expect(seen.some((s) => s.state === 'restarting')).toBe(true), { timeout: 4000 })
  })

  it('times out a command that gets no answer', async () => {
    const { vision } = make('hang', { heartbeatMs: 60_000 })
    await vision.start()
    await expect(vision.request('health', {}, 50)).rejects.toThrow(/did not answer/)
  })

  it('stops a service that ignores the request to shut down', async () => {
    const { vision } = make('hang', { heartbeatMs: 60_000, shutdownTimeoutMs: 50 })
    await vision.start()
    await vision.stop()
    expect(vision.status().state).toBe('stopped')
  })
})

const realService = resolve('ai-vision/.venv/Scripts/python.exe')

describe.runIf(existsSync(realService))('the real Python service', () => {
  it('starts, reports real health, and shuts down', async () => {
    const { vision } = make('normal', {
      locate: () => ({ command: realService, args: ['-m', 'hmms_vision'], cwd: resolve('ai-vision') }),
      startupTimeoutMs: 15_000,
      requestTimeoutMs: 5000,
      heartbeatMs: 60_000
    })
    await vision.start()
    expect(vision.status()).toMatchObject({ state: 'running', version: '0.1.0' })
    await expect(vision.request('health')).resolves.toMatchObject({ memoryTotalMb: expect.any(Number) })
    await expect(vision.request('cameras.discover')).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ index: 0 })]))
    await vision.stop()
    expect(vision.status().state).toBe('stopped')
  }, 30_000)
})
