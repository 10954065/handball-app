import { cameraEventSchema, frameEventSchema, type CameraFeedDTO, type CameraSpec, type VisionState } from '@shared/vision'

type Send = (cmd: string, args: unknown) => Promise<unknown>

interface Feed {
  spec: CameraSpec
  view: CameraFeedDTO
  frame: Buffer | null
}

const SERVICE_GONE: VisionState[] = ['stopped', 'failed', 'not_installed']

/**
 * The cameras currently open. Each holds only its newest picture, so memory cannot grow however
 * far behind the screen falls. Specs can hold passwords: they stay here and are never logged.
 */
export class CameraFeeds {
  private readonly feeds = new Map<string, Feed>()
  private serviceLost = false

  constructor(
    private readonly send: Send,
    private readonly onChange: (states: CameraFeedDTO[]) => void
  ) {}

  states(): CameraFeedDTO[] {
    return [...this.feeds.values()].map((f) => f.view)
  }

  latest(id: string): Buffer | null {
    return this.feeds.get(id)?.frame ?? null
  }

  async open(spec: CameraSpec): Promise<void> {
    // Registered first: a quick camera reports that it is live before this request is answered.
    this.feeds.set(spec.id, { spec, frame: null, view: { id: spec.id, state: 'connecting', message: null, width: null, height: null } })
    this.changed()
    try {
      await this.send('camera.open', spec)
    } catch (err) {
      this.feeds.delete(spec.id)
      this.changed()
      throw err
    }
  }

  async close(id: string): Promise<void> {
    if (!this.feeds.delete(id)) return
    this.changed()
    await this.send('camera.close', { id })
  }

  async closeAll(): Promise<void> {
    await Promise.allSettled([...this.feeds.keys()].map((id) => this.close(id)))
  }

  onEvent(header: Record<string, unknown>, payload: Buffer): void {
    const frame = frameEventSchema.safeParse(header)
    if (frame.success) {
      const feed = this.feeds.get(frame.data.camera)
      if (feed) feed.frame = payload
      return
    }
    const camera = cameraEventSchema.safeParse(header)
    if (!camera.success) return
    const feed = this.feeds.get(camera.data.camera)
    if (!feed) return
    const { state, message, width, height } = camera.data
    feed.view = { ...feed.view, state, message, width: width ?? feed.view.width, height: height ?? feed.view.height }
    if (state === 'failed' || state === 'closed') feed.frame = null
    this.changed()
  }

  /** The service holds no memory of cameras across a restart, so they are opened again here. */
  onServiceState(state: VisionState): void {
    if (state === 'restarting') {
      this.serviceLost = true
      for (const feed of this.feeds.values()) feed.view = { ...feed.view, state: 'reconnecting', message: 'The AI service is restarting.' }
      this.changed()
    } else if (state === 'running' && this.serviceLost) {
      this.serviceLost = false
      for (const feed of this.feeds.values()) void this.send('camera.open', feed.spec).catch(() => undefined)
    } else if (SERVICE_GONE.includes(state)) {
      this.serviceLost = false
      this.feeds.clear()
      this.changed()
    }
  }

  private changed(): void {
    this.onChange(this.states())
  }
}
