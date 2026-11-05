import type { HandlerMap } from '../types'
import { confirmLineup, getMatchSetup, reopenLineup, saveLineup } from '../../services/lineups'

export const lineupHandlers = {
  'lineups.get': ({ id }, ctx) => getMatchSetup(ctx, id),
  'lineups.save': (input, ctx) => saveLineup(ctx, input),
  'lineups.confirm': (input, ctx) => confirmLineup(ctx, input),
  'lineups.reopen': (input, ctx) => reopenLineup(ctx, input)
} satisfies Partial<HandlerMap>
