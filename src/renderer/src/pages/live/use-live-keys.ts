import { useEffect, useRef, useState } from 'react'
import type { Side } from '@shared/domain/constants'
import type { LivePlayerDTO, LiveMatchDTO } from '@shared/dto'

/** Wait this long after the last digit before selecting an exact jersey match (e.g. "1" vs "12"). */
const JERSEY_PAUSE_MS = 700

export interface KeyActions {
  toggleClock: () => void
  select: (side: Side, p: LivePlayerDTO) => void
  clear: () => void
  undo: () => void
  /** Letter shortcuts for the selected player (G, S, M, P, B, F, T, L, K, U). */
  action: (key: string) => boolean
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || !!document.querySelector('[role="dialog"]')
}

/**
 * Keyboard operation of the match centre: Space toggles the clock, H/A choose the team, digits
 * select a jersey, letters record events for the selected player, Esc clears, Ctrl+Z undoes.
 */
export function useLiveKeys(live: LiveMatchDTO | undefined, enabled: boolean, actions: KeyActions) {
  const [typed, setTyped] = useState<{ side: Side; digits: string } | null>(null)
  const armed = useRef<Side>('home')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latest = useRef({ live, actions, typed })
  latest.current = { live, actions, typed }

  useEffect(() => {
    if (!enabled) return
    const pick = (side: Side, digits: string, final: boolean) => {
      const players = latest.current.live?.[side].players ?? []
      const exact = players.find((p) => String(p.jerseyNumber) === digits)
      const longer = players.some((p) => String(p.jerseyNumber).startsWith(digits) && String(p.jerseyNumber) !== digits)
      if (exact && (!longer || final)) {
        latest.current.actions.select(side, exact)
        setTyped(null)
        return true
      }
      if (final) setTyped(null)
      return false
    }
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.altKey || e.metaKey) return
      const k = e.key
      if (e.ctrlKey) {
        if (k.toLowerCase() === 'z') {
          e.preventDefault()
          latest.current.actions.undo()
        }
        return
      }
      if (k === ' ') {
        e.preventDefault()
        latest.current.actions.toggleClock()
        return
      }
      if (k === 'Escape') {
        setTyped(null)
        latest.current.actions.clear()
        return
      }
      if (k === 'h' || k === 'H' || k === 'a' || k === 'A') {
        armed.current = k.toLowerCase() === 'h' ? 'home' : 'away'
        setTyped({ side: armed.current, digits: '' })
        latest.current.actions.clear()
        return
      }
      if (/^[0-9]$/.test(k)) {
        const side = latest.current.typed?.side ?? armed.current
        const digits = ((latest.current.typed?.digits ?? '') + k).slice(-2)
        if (timer.current) clearTimeout(timer.current)
        setTyped({ side, digits })
        if (!pick(side, digits, false)) timer.current = setTimeout(() => pick(side, digits, true), JERSEY_PAUSE_MS)
        return
      }
      if (k === 'Enter' && latest.current.typed?.digits) {
        pick(latest.current.typed.side, latest.current.typed.digits, true)
        return
      }
      if (/^[a-z]$/i.test(k) && latest.current.actions.action(k.toUpperCase())) e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      if (timer.current) clearTimeout(timer.current)
    }
  }, [enabled])

  return typed
}
