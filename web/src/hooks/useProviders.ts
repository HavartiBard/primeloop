import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchProviders, createProvider, updateProvider, deleteProvider } from '../api'
import type { Provider } from '../types'

export function useProviders() {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: ['providers'],
    queryFn: fetchProviders,
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['providers'] })

  const create = useMutation({
    mutationFn: createProvider,
    onSuccess: invalidate,
  })

  const update = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Omit<Provider, 'id' | 'created_at'>> }) =>
      updateProvider(id, data),
    onSuccess: invalidate,
  })

  const remove = useMutation({
    mutationFn: deleteProvider,
    onSuccess: invalidate,
  })

  return {
    providers: Array.isArray(query.data) ? query.data : [],
    isLoading: query.isLoading,
    isError: query.isError,
    create: (data: Omit<Provider, 'id' | 'created_at'>) => create.mutate(data),
    update: (id: string, data: Partial<Omit<Provider, 'id' | 'created_at'>>) =>
      update.mutate({ id, data }),
    remove: (id: string) => remove.mutate(id),
  }
}
