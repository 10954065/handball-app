import { Bar, BarChart, CartesianGrid, LabelList, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatMatchTime } from '@shared/domain/periods'
import type { ScoreFlowPoint } from '@shared/domain/statistics'

const AXIS = { fontSize: 11, fill: 'var(--text-faint)' }
const INK = { fontSize: 12, fill: 'var(--text-muted)' }
const TOOLTIP = {
  contentStyle: { background: 'var(--surface-3)', border: '1px solid var(--border-strong)', borderRadius: 8, fontSize: 12 },
  labelStyle: { color: 'var(--text)' },
  itemStyle: { color: 'var(--text-muted)' }
}

const MINUTE = 60_000
const TICK_MINUTES = 10

interface RankedBarsProps {
  rows: { name: string; value: number }[]
  valueLabel: string
}

/** A ranking of one measure. Values are labelled at the end of each bar, so no axis is needed. */
export function RankedBars({ rows, valueLabel }: RankedBarsProps) {
  return (
    <ResponsiveContainer width="100%" height={rows.length * 30 + 12}>
      <BarChart data={rows} layout="vertical" margin={{ top: 6, right: 36, bottom: 6, left: 0 }} barCategoryGap={8}>
        <XAxis type="number" hide domain={[0, 'dataMax']} />
        <YAxis type="category" dataKey="name" width={170} tickLine={false} axisLine={false} tick={INK} interval={0} />
        <Tooltip cursor={{ fill: 'var(--surface-2)' }} {...TOOLTIP} />
        <Bar dataKey="value" name={valueLabel} fill="var(--primary)" radius={[0, 4, 4, 0]} isAnimationActive={false}>
          <LabelList dataKey="value" position="right" style={{ ...INK, fontWeight: 600 }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

interface ScoreFlowChartProps {
  flow: ScoreFlowPoint[]
  /** Match time at the end of the chart. */
  endMs: number
  home: string
  away: string
}

/** The score over the match. Stepped, because the score changes only when a goal is scored. */
export function ScoreFlowChart({ flow, endMs, home, away }: ScoreFlowChartProps) {
  const last = flow[flow.length - 1] ?? { home: 0, away: 0 }
  const data = [{ matchMs: 0, home: 0, away: 0 }, ...flow.map((p) => ({ matchMs: p.matchMs, home: p.home, away: p.away })), { matchMs: Math.max(endMs, last.matchMs ?? 0), home: last.home, away: last.away }]
  const end = data[data.length - 1].matchMs
  const ticks = Array.from({ length: Math.floor(end / (TICK_MINUTES * MINUTE)) + 1 }, (_, i) => i * TICK_MINUTES * MINUTE)
  return (
    <div>
      <ul className="mb-2 flex gap-5 text-xs text-muted" aria-label="Legend">
        <li className="flex items-center gap-2">
          <span className="h-0.5 w-5 rounded-full" style={{ background: 'var(--chart-home)' }} aria-hidden /> {home}
        </li>
        <li className="flex items-center gap-2">
          <span className="h-0.5 w-5 rounded-full" style={{ background: 'var(--chart-away)' }} aria-hidden /> {away}
        </li>
      </ul>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 8, right: 24, bottom: 0, left: -18 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.6} />
          <XAxis dataKey="matchMs" type="number" domain={[0, end]} ticks={ticks} tickFormatter={(ms: number) => `${ms / MINUTE}'`} tick={AXIS} tickLine={false} axisLine={{ stroke: 'var(--border)' }} />
          <YAxis allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false} />
          <Tooltip labelFormatter={(ms) => formatMatchTime(Number(ms))} {...TOOLTIP} />
          <Line type="stepAfter" dataKey="home" name={home} stroke="var(--chart-home)" strokeWidth={2} dot={false} isAnimationActive={false} />
          <Line type="stepAfter" dataKey="away" name={away} stroke="var(--chart-away)" strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
