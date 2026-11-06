// Stands in for the Python service in tests, including all the ways it can misbehave.
import { createInterface } from 'node:readline'

const mode = process.argv[2] ?? 'normal'

function send(header, payload = Buffer.alloc(0)) {
  const body = Buffer.from(JSON.stringify(header))
  const lengths = Buffer.alloc(8)
  lengths.writeUInt32LE(body.length, 0)
  lengths.writeUInt32LE(payload.length, 4)
  process.stdout.write(Buffer.concat([lengths, body, payload]))
}

if (mode === 'silent') {
  // Never introduces itself.
} else if (mode === 'garbage') {
  process.stdout.write(Buffer.alloc(64, 0xff))
} else {
  send({ type: 'hello', protocol: mode === 'wrong-protocol' ? 999 : 1, version: '0.0.1', python: 'fake' })
}

if (mode === 'crash') setTimeout(() => process.exit(3), 20)

let requests = 0
createInterface({ input: process.stdin }).on('line', (line) => {
  const { id, cmd } = JSON.parse(line)
  requests++
  if (mode === 'hang' || mode === 'crash' || (mode === 'hang-later' && requests > 1)) return
  if (cmd === 'shutdown') {
    send({ type: 'reply', id, ok: true, data: {} })
    process.exit(0)
  }
  if (cmd === 'fail') return send({ type: 'reply', id, ok: false, error: 'Camera 2 is not connected.' })
  if (cmd === 'emit') return send({ type: 'frame', camera: 'a' }, Buffer.from('jpeg-bytes'))
  send({ type: 'reply', id, ok: true, data: { cpuPercent: 1, memoryUsedMb: 2, memoryTotalMb: 3, serviceMemoryMb: 4 } })
})
process.stdin.on('end', () => process.exit(0))
