/** Far above any real message. A larger length means the stream is broken, not that a frame is big. */
const MAX_HEADER_BYTES = 1_048_576
const MAX_PAYLOAD_BYTES = 16_777_216
const LENGTHS_BYTES = 8

export class ProtocolViolation extends Error {}

export type FrameListener = (header: Record<string, unknown>, payload: Buffer) => void

/**
 * Splits the service's output into frames: two little-endian uint32 lengths, a JSON header, then a
 * binary payload. Nothing it says is trusted, so lengths are checked before anything is allocated.
 */
export class FrameParser {
  private pending: Buffer = Buffer.alloc(0)

  constructor(private readonly onFrame: FrameListener) {}

  push(chunk: Buffer): void {
    this.pending = this.pending.length ? Buffer.concat([this.pending, chunk]) : chunk
    while (this.pending.length >= LENGTHS_BYTES) {
      const headerBytes = this.pending.readUInt32LE(0)
      const payloadBytes = this.pending.readUInt32LE(4)
      if (headerBytes > MAX_HEADER_BYTES || payloadBytes > MAX_PAYLOAD_BYTES) throw new ProtocolViolation('The vision service sent an impossible message.')
      const total = LENGTHS_BYTES + headerBytes + payloadBytes
      if (this.pending.length < total) return
      const header = this.parseHeader(this.pending.subarray(LENGTHS_BYTES, LENGTHS_BYTES + headerBytes))
      const payload = Buffer.from(this.pending.subarray(LENGTHS_BYTES + headerBytes, total))
      this.pending = this.pending.subarray(total)
      this.onFrame(header, payload)
    }
  }

  private parseHeader(bytes: Buffer): Record<string, unknown> {
    try {
      const header: unknown = JSON.parse(bytes.toString('utf8'))
      if (typeof header === 'object' && header !== null && !Array.isArray(header)) return header as Record<string, unknown>
    } catch {
      // Reported below, with everything else that is not a valid header.
    }
    throw new ProtocolViolation('The vision service sent an unreadable message.')
  }
}
