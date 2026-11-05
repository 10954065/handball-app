import {
  clockAction,
  editEvent,
  endPeriod,
  endTimeout,
  finishMatch,
  getLive,
  recordEvent,
  recordSanction,
  recoverClock,
  setClock,
  startPeriod,
  startTimeout,
  voidEvent
} from '../../services/live'
import type { HandlerMap, RequestContext } from '../types'

/** Run a live mutation and notify every window (operator screen, public scoreboard). */
const notify =
  <I extends { matchId: string }, O>(fn: (ctx: RequestContext, input: I) => O) =>
  (input: I, ctx: RequestContext): O => {
    const out = fn(ctx, input)
    ctx.app.broadcast('live.changed', { matchId: input.matchId })
    return out
  }

export const liveHandlers = {
  'live.get': ({ matchId }, ctx) => getLive(ctx, matchId),
  'live.startPeriod': notify((ctx, i) => startPeriod(ctx, i.matchId)),
  'live.clock': notify(clockAction),
  'live.setClock': notify(setClock),
  'live.recoverClock': notify(recoverClock),
  'live.endPeriod': notify(endPeriod),
  'live.finish': notify(finishMatch),
  'live.record': notify(recordEvent),
  'live.edit': notify(editEvent),
  'live.void': notify(voidEvent),
  'live.sanction': notify(recordSanction),
  'live.timeoutStart': notify(startTimeout),
  'live.timeoutEnd': notify((ctx, i) => endTimeout(ctx, i.matchId))
} satisfies Partial<HandlerMap>
