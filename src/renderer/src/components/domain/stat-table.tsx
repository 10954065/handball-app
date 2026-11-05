import { useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { cn } from '@/lib/cn'

export interface StatColumn<T> {
  key: string
  label: string
  /** Full name, for the header tooltip. */
  title: string
  value: (row: T) => number | null
  percent?: boolean
}

interface StatTableProps<T> {
  label: string
  nameHeader: string
  rows: T[]
  rowKey: (row: T) => string
  name: (row: T) => ReactNode
  columns: StatColumn<T>[]
  initialSort: string
}

/** A table of numbers, sorted by any column. A rate with nothing to measure sorts last. */
export function StatTable<T>({ label, nameHeader, rows, rowKey, name, columns, initialSort }: StatTableProps<T>) {
  const [sort, setSort] = useState({ key: initialSort, descending: true })
  const column = columns.find((c) => c.key === sort.key) ?? columns[0]
  const sorted = [...rows].sort((a, b) => {
    const [x, y] = [column.value(a), column.value(b)]
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1
    return sort.descending ? y - x : x - y
  })
  const toggle = (key: string) => setSort((s) => ({ key, descending: s.key === key ? !s.descending : true }))
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm" aria-label={label}>
        <thead>
          <tr>
            <th className="sticky left-0 z-10 border-b border-border bg-surface-1 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-faint">{nameHeader}</th>
            {columns.map((c) => (
              <th key={c.key} aria-sort={c.key === column.key ? (sort.descending ? 'descending' : 'ascending') : 'none'} className="border-b border-border p-0">
                <button
                  title={c.title}
                  onClick={() => toggle(c.key)}
                  className={cn('flex w-full items-center justify-end gap-1 whitespace-nowrap px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider transition-colors hover:text-text', c.key === column.key ? 'text-text' : 'text-faint')}
                >
                  {c.label}
                  {c.key === column.key && (sort.descending ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />)}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={rowKey(row)} className="border-b border-border/60 last:border-0">
              <td className="sticky left-0 z-10 bg-surface-1 px-4 py-2">{name(row)}</td>
              {columns.map((c) => {
                const v = c.value(row)
                return (
                  <td key={c.key} className={cn('px-3 py-2 text-right tabular', c.key === column.key ? 'font-semibold text-text' : 'text-muted')}>
                    {v === null ? '-' : c.percent ? `${v}%` : v}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
