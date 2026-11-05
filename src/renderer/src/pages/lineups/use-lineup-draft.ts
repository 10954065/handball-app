import { useMemo, useState } from 'react'
import { validateLineup } from '@shared/domain/lineup'
import type { RulesConfig } from '@shared/domain/rules'
import type { SideSetupDTO, SquadPlayerDTO } from '@shared/dto'

export interface DraftEntry {
  playerId: string
  jerseyNumber: number
  isStarting: boolean
  isStartingGk: boolean
  isCaptain: boolean
}

export interface DraftOfficial {
  slot: 'A' | 'B' | 'C' | 'D'
  name: string
  role: string
}

function initialOfficials(side: SideSetupDTO): DraftOfficial[] {
  if (side.officials.length) return side.officials.map(({ slot, name, role }) => ({ slot, name, role }))
  const staff: DraftOfficial[] = []
  const slots = ['A', 'B', 'C', 'D'] as const
  for (const [name, role] of [[side.coach, 'Head coach'], [side.assistantCoach, 'Assistant coach'], [side.teamManager, 'Team manager']] as const) {
    if (name) staff.push({ slot: slots[staff.length], name, role })
  }
  return staff
}

/** Local editing state for one team match sheet, validated live with the shared rules engine. */
export function useLineupDraft(side: SideSetupDTO, rules: RulesConfig) {
  const [entries, setEntries] = useState<DraftEntry[]>(() =>
    side.entries.map((e) => ({ playerId: e.playerId, jerseyNumber: e.jerseyNumber, isStarting: e.isStarting, isStartingGk: e.isStartingGk, isCaptain: e.isCaptain }))
  )
  const [officials, setOfficials] = useState<DraftOfficial[]>(() => initialOfficials(side))
  const [dirty, setDirty] = useState(false)
  const squad = useMemo(() => new Map(side.squad.map((p) => [p.playerId, p])), [side.squad])

  const update = (fn: (e: DraftEntry[]) => DraftEntry[]) => {
    setEntries(fn)
    setDirty(true)
  }
  const starters = entries.filter((e) => e.isStarting)
  const has = (id: string) => entries.some((e) => e.playerId === id)

  const add = (p: SquadPlayerDTO) => {
    if (has(p.playerId) || entries.length >= rules.roster.maxPlayers || !p.eligible) return false
    update((es) => [...es, { playerId: p.playerId, jerseyNumber: p.jerseyNumber, isStarting: false, isStartingGk: false, isCaptain: p.isTeamCaptain && !es.some((x) => x.isCaptain) }])
    return true
  }
  const remove = (id: string) => update((es) => es.filter((e) => e.playerId !== id))
  const toggleStart = (id: string) => {
    const e = entries.find((x) => x.playerId === id)
    if (!e) return 'missing'
    if (!e.isStarting && starters.length >= rules.roster.onCourt) return 'full'
    update((es) => es.map((x) => (x.playerId === id ? { ...x, isStarting: !x.isStarting, isStartingGk: x.isStarting ? false : x.isStartingGk } : x)))
    return 'ok'
  }
  const setGk = (id: string) =>
    update((es) => es.map((x) => ({ ...x, isStartingGk: x.playerId === id ? !x.isStartingGk : false, isStarting: x.playerId === id ? true : x.isStarting })))
  const setCaptain = (id: string) => update((es) => es.map((x) => ({ ...x, isCaptain: x.playerId === id ? !x.isCaptain : false })))

  /** Add every eligible player up to the match-sheet limit, keeping existing choices. */
  const selectSquad = () =>
    update((es) => {
      const next = [...es]
      for (const p of side.squad) {
        if (next.length >= rules.roster.maxPlayers) break
        if (p.eligible && !next.some((e) => e.playerId === p.playerId)) next.push({ playerId: p.playerId, jerseyNumber: p.jerseyNumber, isStarting: false, isStartingGk: false, isCaptain: false })
      }
      if (!next.some((e) => e.isCaptain)) {
        const cap = side.squad.find((p) => p.isTeamCaptain && next.some((e) => e.playerId === p.playerId))
        if (cap) return next.map((e) => ({ ...e, isCaptain: e.playerId === cap.playerId }))
      }
      return next
    })

  /** Suggest a starting seven: the primary goalkeeper plus six court players covering positions. */
  const suggestSeven = () =>
    update((es) => {
      const pool = es.map((e) => ({ e, p: squad.get(e.playerId)! }))
      const gk = pool.find((x) => x.p.isPrimaryGoalkeeper) ?? pool.find((x) => x.p.isGoalkeeper)
      const chosen = new Set<string>(gk ? [gk.e.playerId] : [])
      for (const pos of ['left_wing', 'left_back', 'centre_back', 'right_back', 'right_wing', 'pivot'] as const) {
        const hit = pool.find((x) => !chosen.has(x.e.playerId) && x.p.position === pos)
        if (hit) chosen.add(hit.e.playerId)
      }
      for (const x of pool) if (chosen.size < rules.roster.onCourt && !x.p.isGoalkeeper) chosen.add(x.e.playerId)
      return es.map((e) => ({ ...e, isStarting: chosen.has(e.playerId), isStartingGk: !!gk && e.playerId === gk.e.playerId }))
    })

  const validation = useMemo(
    () => validateLineup(entries.map((e) => ({ ...e, jersey: e.jerseyNumber, isGoalkeeper: squad.get(e.playerId)?.isGoalkeeper ?? false })), rules),
    [entries, rules, squad]
  )
  const setOfficialsDirty = (o: DraftOfficial[]) => {
    setOfficials(o)
    setDirty(true)
  }
  return { entries, officials, setOfficials: setOfficialsDirty, dirty, setDirty, squad, starters, has, add, remove, toggleStart, setGk, setCaptain, selectSquad, suggestSeven, validation }
}
