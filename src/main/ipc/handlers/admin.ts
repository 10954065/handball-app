import type { HandlerMap } from '../types'
import * as competitions from '../../services/competitions'
import { getDashboard } from '../../services/dashboard'
import * as directory from '../../services/directory'
import * as matches from '../../services/matches'
import { saveMedia } from '../../services/media'
import * as players from '../../services/players'
import { seasonStandings } from '../../services/standings'
import * as teams from '../../services/teams'

export const adminHandlers = {
  'dashboard.get': (_i, ctx) => getDashboard(ctx),
  'media.upload': (input, ctx) => saveMedia(ctx, input),

  'teams.list': (q, ctx) => teams.listTeams(ctx, q),
  'teams.get': ({ id }, ctx) => teams.getTeam(ctx, id),
  'teams.create': (input, ctx) => teams.createTeam(ctx, input),
  'teams.update': (input, ctx) => teams.updateTeam(ctx, input),
  'teams.archive': ({ id, archived }, ctx) => teams.setTeamArchived(ctx, id, archived),

  'players.list': (q, ctx) => players.listPlayers(ctx, q),
  'players.get': ({ id }, ctx) => players.getPlayer(ctx, id),
  'players.create': (input, ctx) => players.createPlayer(ctx, input),
  'players.update': (input, ctx) => players.updatePlayer(ctx, input),
  'players.archive': ({ id, archived }, ctx) => players.setPlayerArchived(ctx, id, archived),
  'players.transfer': (input, ctx) => players.transferPlayer(ctx, input),
  'players.changeJersey': (input, ctx) => players.changeJersey(ctx, input),

  'officials.list': (q, ctx) => directory.listOfficials(ctx, q),
  'officials.create': (input, ctx) => directory.createOfficial(ctx, input),
  'officials.update': (input, ctx) => directory.updateOfficial(ctx, input),
  'officials.archive': ({ id, archived }, ctx) => directory.setOfficialArchived(ctx, id, archived),
  'venues.list': (q, ctx) => directory.listVenues(ctx, q),
  'venues.create': (input, ctx) => directory.createVenue(ctx, input),
  'venues.update': (input, ctx) => directory.updateVenue(ctx, input),
  'venues.archive': ({ id, archived }, ctx) => directory.setVenueArchived(ctx, id, archived),

  'competitions.list': (q, ctx) => competitions.listCompetitions(ctx, q),
  'competitions.get': ({ id }, ctx) => competitions.getCompetition(ctx, id),
  'competitions.create': (input, ctx) => competitions.createCompetition(ctx, input),
  'competitions.update': (input, ctx) => competitions.updateCompetition(ctx, input),
  'competitions.archive': ({ id, archived }, ctx) => competitions.setCompetitionArchived(ctx, id, archived),
  'seasons.create': (input, ctx) => competitions.createSeason(ctx, input),
  'seasons.update': (input, ctx) => competitions.updateSeason(ctx, input),
  'seasons.setTeams': (input, ctx) => competitions.setSeasonTeams(ctx, input),
  'seasons.standings': ({ id }, ctx) => seasonStandings(ctx, id),

  'matches.list': (q, ctx) => matches.listMatches(ctx, q),
  'matches.get': ({ id }, ctx) => matches.getMatch(ctx, id),
  'matches.create': (input, ctx) => matches.createMatch(ctx, input),
  'matches.update': (input, ctx) => matches.updateMatch(ctx, input),
  'matches.delete': ({ id }, ctx) => matches.deleteMatch(ctx, id)
} satisfies Partial<HandlerMap>
