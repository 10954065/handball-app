import type { SideSetupDTO } from '@shared/dto'
import { AppError } from '@shared/errors'
import type { SheetTeamDTO, TeamSheetDTO } from '@shared/vision'
import type { Ctx } from './ctx'
import { getMatchSetup } from './lineups'

const sheetTeam = (side: SideSetupDTO): SheetTeamDTO => ({
  name: side.teamName,
  players: side.entries.map((e) => ({ number: e.jerseyNumber, name: e.name }))
})

/** Who a camera may name in a match: the players entered on its match sheet, and nobody else. */
export function teamSheet(ctx: Ctx, matchId: string): TeamSheetDTO {
  const { home, away } = getMatchSetup(ctx, matchId)
  if (!home.entries.length && !away.entries.length) throw new AppError('CONFLICT', 'This match has no players on its match sheet yet. Enter them under Match sheet first.')
  return { matchId, a: sheetTeam(home), b: sheetTeam(away) }
}
