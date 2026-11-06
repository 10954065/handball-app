import { analysisEventSchema, cameraEventSchema, frameEventSchema, tracksEventSchema, type AnalysisDTO, type CameraFeedDTO, type CameraSpec, type CameraTracksDTO, type VisionState } from '@shared/vision'

type Send = (cmd: string, args: unknown) => Promise<unknown>

interface Feed {
  spec: CameraSpec
  view: CameraFeedDTO
  frame: Buffer | null
}

const SERVICE_GONE: VisionState[] = ['stopped', 'failed', 'not_installed']
const NO_ANALYSIS: AnalysisDTO = { state: 'stopped', message: null, backend: null, fps: 0, inferenceMs: 0, dropped: 0, tracked: 0, named: 0 }

export interface FeedListeners {
  onFeeds: (states: CameraFeedDTO[]) => void
  onAnalysis: (analysis: AnalysisDTO) => void
  onTracks: (tracks: CameraTracksDTO) => void
}

/**
 * The cameras currently open. Each holds only its newest picture, so memory cannot grow however
 * far behind the screen falls. Specs can hold passwords: they stay here and are never logged.
 */
export class CameraFeeds {
  private readonly feeds = new Map<string, Feed>()
  private serviceLost = false
  private current: AnalysisDTO = NO_ANALYSIS

  constructor(
    private readonly send: Send,
    private readonly listeners: FeedListeners
  ) {}

  analysis(): AnalysisDTO {
    return this.current
  }

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
    const tracks = tracksEventSchema.safeParse(header)
    if (tracks.success) {
      const { camera, width, height, fps, inferenceMs, dropped } = tracks.data
      this.setAnalysis({ ...this.current, fps, inferenceMs, dropped, tracked: tracks.data.tracks.length, named: tracks.data.tracks.filter((t) => t.number !== null).length })
      this.listeners.onTracks({ camera, width, height, tracks: tracks.data.tracks })
      return
    }
    const analysis = analysisEventSchema.safeParse(header)
    if (analysis.success) {
      const { state, message, backend } = analysis.data
      this.setAnalysis({ ...NO_ANALYSIS, state, message, backend: backend ?? this.current.backend })
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
      this.setAnalysis(NO_ANALYSIS)
      for (const feed of this.feeds.values()) feed.view = { ...feed.view, state: 'reconnecting', message: 'The AI service is restarting.' }
      this.changed()
    } else if (state === 'running' && this.serviceLost) {
      this.serviceLost = false
      for (const feed of this.feeds.values()) void this.send('camera.open', feed.spec).catch(() => undefined)
    } else if (SERVICE_GONE.includes(state)) {
      this.serviceLost = false
      this.feeds.clear()
      this.changed()
      this.setAnalysis(NO_ANALYSIS)
    }
  }

  private setAnalysis(analysis: AnalysisDTO): void {
    this.current = analysis
    this.listeners.onAnalysis(analysis)
  }

  private changed(): void {
    this.listeners.onFeeds(this.states())
  }
}
