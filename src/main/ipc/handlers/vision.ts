import { vision } from '../../vision/instance'
import type { HandlerMap } from '../types'

export const visionHandlers = {
  'vision.status': () => vision.status(),
  'vision.start': async () => {
    await vision.start()
    return vision.status()
  },
  'vision.stop': async () => {
    await vision.stop()
    return vision.status()
  }
} satisfies Partial<HandlerMap>
