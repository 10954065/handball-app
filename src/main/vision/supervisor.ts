import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import { helloSchema, replySchema, VISION_PROTOCOL, visionHealthSchema, type VisionHealth, type VisionState, type VisionStatus } from '@shared/vision'
import { FrameParser, type FrameListener } from './frames'

export interface VisionCommand {
  command: string
  args: string[]
  cwd?: string
}

export interface VisionOptions {
  /** Where the service is. Null when it is not installed, which is a normal state for HMMS. */
  locate: () => VisionCommand | null
  onStatus: (status: VisionStatus) => void
  onEvent: FrameListener
  log: { info: (m: string, meta?: unknown) => void; warn: (m: string, meta?: unknown) => void; error: (m: string, meta?: unknown) => void }
  heartbeatMs?: number
  startupTimeoutMs?: number
  requestTimeoutMs?: number
  shutdownTimeoutMs?: number
  restartDelayMs?: number
  maxRestarts?: number
}

interface Pending {
  resolve: (data: unknown) => void
  reject: (err: Error) => void
  timer: NodeJS.Timeout
}

const RESTART_WINDOW_MS = 60_000
const MISSED_HEARTBEATS_ALLOWED = 2

/**
 * Runs the Python vision service as a child process and keeps it contained. Everything here is
 * asynchronous and nothing here touches a match: if the service crashes, hangs or sends nonsense,
 * the worst outcome is that AI Vision stops, and the status says why.
 */
export class VisionSupervisor {
  private child: ChildProcessWithoutNullStreams | null = null
  private state: VisionState = 'stopped'
  private message: string | null = null
  private version: string | null = null
  private health: VisionHealth | null = null
  private restarts = 0
  private restartTimes: number[] = []
  private wanted = false
  private nextId = 1
  private missedHeartbeats = 0
  private heartbeat: NodeJS.Timeout | null = null
  private restartTimer: NodeJS.Timeout | null = null
  private readonly pending = new Map<number, Pending>()
  private started: { resolve: () => void; timer: NodeJS.Timeout } | null = null
  private waiting: (() => void)[] = []

  constructor(private readonly options: VisionOptions) {}

  status(): VisionStatus {
    return { state: this.state, message: this.message, version: this.version, restarts: this.restarts, health: this.health }
  }

  /** Resolves once the service is running or has failed. It never rejects: read the status. */
  async start(): Promise<void> {
    if (this.state === 'running') return
    // Already on its way: the caller needs the outcome, not a promise that was never made.
    if (this.child || this.restartTimer) return new Promise((resolve) => this.waiting.push(resolve))
    this.wanted = true
    this.restarts = 0
    this.restartTimes = []
    await this.launch('starting')
  }

  async stop(): Promise<void> {
    this.wanted = false
    if (this.restartTimer) clearTimeout(this.restartTimer)
    this.restartTimer = null
    const child = this.child
    if (child) {
      const limit = this.options.shutdownTimeoutMs ?? 3000
      const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
      // Saying yes is not leaving. Closing HMMS waits here, so this must always end.
      const deadline = setTimeout(() => this.kill(child), limit)
      void this.request('shutdown', {}, limit).catch(() => this.kill(child))
      await exited
      clearTimeout(deadline)
    }
    this.setState('stopped', null)
  }

  /** Send a command. Rejects if the service is not running, refuses it, or does not answer. */
  request(cmd: string, args: unknown = {}, timeoutMs = this.options.requestTimeoutMs ?? 10_000): Promise<unknown> {
    const child = this.child
    if (!child || this.state !== 'running') return Promise.reject(new Error('The vision service is not running.'))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('The vision service did not answer.'))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      child.stdin.write(`${JSON.stringify({ id, cmd, args })}\n`)
    })
  }

  private launch(state: VisionState): Promise<void> {
    const target = this.options.locate()
    if (!target) {
      this.wanted = false
      this.setState('not_installed', 'AI Vision is not installed on this computer. Everything else in HMMS works as normal.')
      return Promise.resolve()
    }
    this.setState(state, null)
    this.options.log.info('Starting the vision service')
    const child = spawn(target.command, target.args, {
      cwd: target.cwd,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONDONTWRITEBYTECODE: '1' }
    })
    this.child = child
    const parser = new FrameParser((header, payload) => this.onFrame(child, header, payload))
    child.stdout.on('data', (chunk: Buffer) => {
      try {
        parser.push(chunk)
      } catch (err) {
        this.fail(child, (err as Error).message)
      }
    })
    createInterface({ input: child.stderr }).on('line', (line) => this.options.log.info(`vision: ${line}`))
    child.stdin.on('error', (err) => this.options.log.warn('Could not write to the vision service', err))
    child.on('error', (err) => {
      this.options.log.error('Could not start the vision service', err)
      this.fail(child, 'The vision service could not be started.')
    })
    child.on('exit', (code) => this.onExit(child, code))
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => this.fail(child, 'The vision service did not start in time.'), this.options.startupTimeoutMs ?? 30_000)
      this.started = { resolve, timer }
    })
  }

  private onFrame(child: ChildProcessWithoutNullStreams, header: Record<string, unknown>, payload: Buffer): void {
    if (child !== this.child) return
    if (header.type === 'hello') return this.onHello(child, header)
    if (header.type === 'reply') return this.onReply(child, header)
    this.options.onEvent(header, payload)
  }

  private onHello(child: ChildProcessWithoutNullStreams, header: Record<string, unknown>): void {
    const hello = helloSchema.safeParse(header)
    if (!hello.success || hello.data.protocol !== VISION_PROTOCOL) {
      this.wanted = false
      this.fail(child, 'The installed vision service does not match this version of HMMS. Reinstall HMMS to repair it.')
      return
    }
    this.version = hello.data.version
    this.setState('running', null)
    this.options.log.info('Vision service started', hello.data)
    this.startHeartbeat(child)
    this.settleStart()
  }

  private onReply(child: ChildProcessWithoutNullStreams, header: Record<string, unknown>): void {
    const reply = replySchema.safeParse(header)
    if (!reply.success) return this.fail(child, 'The vision service sent an unreadable message.')
    const waiting = this.pending.get(reply.data.id)
    if (!waiting) return
    this.pending.delete(reply.data.id)
    clearTimeout(waiting.timer)
    if (reply.data.ok) waiting.resolve(reply.data.data)
    else waiting.reject(new Error(reply.data.error))
  }

  private startHeartbeat(child: ChildProcessWithoutNullStreams): void {
    this.missedHeartbeats = 0
    this.heartbeat = setInterval(() => {
      this.request('health')
        .then((data) => {
          this.missedHeartbeats = 0
          const health = visionHealthSchema.safeParse(data)
          if (health.success) {
            this.health = health.data
            this.options.onStatus(this.status())
          }
        })
        .catch(() => {
          if (child !== this.child || ++this.missedHeartbeats < MISSED_HEARTBEATS_ALLOWED) return
          this.options.log.warn('The vision service stopped answering')
          this.kill(child)
        })
    }, this.options.heartbeatMs ?? 5000)
  }

  private fail(child: ChildProcessWithoutNullStreams, message: string): void {
    if (child !== this.child) return
    this.message = message
    this.options.log.warn(message)
    this.kill(child)
  }

  /** The launcher in a Python environment starts a second process, so the whole tree has to go. */
  private kill(child: ChildProcessWithoutNullStreams): void {
    if (child.pid && process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
    else child.kill('SIGKILL')
  }

  private onExit(child: ChildProcessWithoutNullStreams, code: number | null): void {
    if (child !== this.child) return
    this.child = null
    this.health = null
    if (this.heartbeat) clearInterval(this.heartbeat)
    this.heartbeat = null
    for (const [id, waiting] of this.pending) {
      clearTimeout(waiting.timer)
      waiting.reject(new Error('The vision service stopped.'))
      this.pending.delete(id)
    }
    if (this.wanted) {
      this.options.log.warn('The vision service stopped unexpectedly', { code })
      this.restartOrGiveUp()
    } else if (this.message) {
      this.setState('failed', this.message)
    }
    this.settleStart()
  }

  private restartOrGiveUp(): void {
    const now = Date.now()
    this.restartTimes = [...this.restartTimes.filter((t) => now - t < RESTART_WINDOW_MS), now]
    const allowed = this.options.maxRestarts ?? 3
    if (this.restartTimes.length > allowed) {
      this.wanted = false
      this.setState('failed', this.message ?? 'The vision service keeps stopping. The match console is not affected. Details are in the log folder.')
      return
    }
    this.restarts++
    this.setState('restarting', this.message)
    this.message = null
    const delay = (this.options.restartDelayMs ?? 1000) * 2 ** (this.restartTimes.length - 1)
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      void this.launch('restarting')
    }, delay)
  }

  private settleStart(): void {
    if (this.state === 'restarting') return
    if (this.started) {
      clearTimeout(this.started.timer)
      this.started.resolve()
      this.started = null
    }
    for (const resolve of this.waiting) resolve()
    this.waiting = []
  }

  private setState(state: VisionState, message: string | null): void {
    this.state = state
    this.message = message
    this.options.onStatus(this.status())
  }
}
