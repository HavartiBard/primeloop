import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchAgentRegistry, createAgent, updateAgent, deleteAgent, agentLifecycle } from '../api'
import type { RegistryAgent, LifecycleResult } from '../types'

export function useAgentRegistry() {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: ['agent-registry'],
    queryFn: fetchAgentRegistry,
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['agent-registry'] })

  const create = useMutation({
    mutationFn: createAgent,
    onSuccess: invalidate,
  })

  const update = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Omit<RegistryAgent, 'id' | 'created_at'>> }) =>
      updateAgent(id, data),
    onSuccess: invalidate,
  })

  const remove = useMutation({
    mutationFn: deleteAgent,
    onSuccess: invalidate,
  })

  const lifecycle = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'restart' | 'stop' | 'start' }) =>
      agentLifecycle(id, action),
  })

  return {
    agents: Array.isArray(query.data) ? query.data : [],
    isLoading: query.isLoading,
    isError: query.isError,
    create: (data: Omit<RegistryAgent, 'id' | 'created_at'>) => create.mutate(data),
    update: (id: string, data: Partial<Omit<RegistryAgent, 'id' | 'created_at'>>) =>
      update.mutate({ id, data }),
    remove: (id: string) => remove.mutate(id),
    lifecycle: (id: string, action: 'restart' | 'stop' | 'start') =>
      lifecycle.mutate({ id, action }),
  }
}
