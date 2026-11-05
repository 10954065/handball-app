import { QueryClient, useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { ChannelInput, ChannelName, ChannelOutput } from '@shared/ipc/contract'
import { call, errorMessage } from './api'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15_000, refetchOnWindowFocus: false, retry: false },
    mutations: { retry: false }
  }
})

/** Query a read channel. The query key is [channel, input]. */
export function useApi<K extends ChannelName>(
  channel: K,
  input?: ChannelInput<K>,
  options?: Omit<UseQueryOptions<ChannelOutput<K>>, 'queryKey' | 'queryFn'>
) {
  return useQuery<ChannelOutput<K>>({
    queryKey: [channel, input ?? null],
    queryFn: () => (call as (c: K, i?: ChannelInput<K>) => Promise<ChannelOutput<K>>)(channel, input),
    ...options
  })
}

interface MutationOpts<K extends ChannelName> {
  /** Channel-name prefixes whose queries are invalidated on success, e.g. ['teams.', 'dashboard.'] */
  invalidate?: string[]
  success?: string | ((data: ChannelOutput<K>) => string)
  onSuccess?: (data: ChannelOutput<K>) => void
  /** Show a toast on error (default true). */
  toastError?: boolean
}

export function useApiMutation<K extends ChannelName>(channel: K, opts: MutationOpts<K> = {}) {
  const qc = useQueryClient()
  return useMutation<ChannelOutput<K>, Error, ChannelInput<K>>({
    mutationFn: (input) => (call as (c: K, i?: ChannelInput<K>) => Promise<ChannelOutput<K>>)(channel, input),
    onSuccess: (data) => {
      if (opts.invalidate) {
        void qc.invalidateQueries({
          predicate: (q) => typeof q.queryKey[0] === 'string' && opts.invalidate!.some((p) => (q.queryKey[0] as string).startsWith(p))
        })
      }
      if (opts.success) toast.success(typeof opts.success === 'function' ? opts.success(data) : opts.success)
      opts.onSuccess?.(data)
    },
    onError: (err) => {
      if (opts.toastError !== false) toast.error(errorMessage(err))
    }
  })
}
