import { useState } from 'react'
import type { z } from 'zod'

/**
 * Minimal form state with zod validation. Errors are keyed by the first path segment.
 * The same schema is validated again in the main process (authoritative).
 */
export function useForm<S extends z.ZodType<object, object>>(schema: S, initial: z.input<S>) {
  const [values, setValues] = useState<z.input<S>>(initial)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const set = <K extends keyof z.input<S>>(key: K, value: z.input<S>[K]) => {
    setValues((v) => ({ ...(v as object), [key]: value }) as z.input<S>)
    if (errors[key as string]) setErrors((e) => ({ ...e, [key as string]: '' }))
  }
  const validate = (): z.output<S> | null => {
    const r = schema.safeParse(values)
    if (r.success) {
      setErrors({})
      return r.data
    }
    const next: Record<string, string> = {}
    for (const i of r.error.issues) next[String(i.path[0] ?? 'form')] ??= i.message
    setErrors(next)
    return null
  }
  return { values, set, setValues, errors, validate }
}

/** Convert an <input type=number> value to number | null. */
export const numOrNull = (v: string): number | null => (v.trim() === '' || Number.isNaN(Number(v)) ? null : Number(v))
