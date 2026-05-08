import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createMcpServer, deleteMcpServer, fetchMcpServers, updateMcpServer } from '../api'
import type { MCPServer } from '../types'

export function useMcpServers() {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: ['mcp-servers'],
    queryFn: fetchMcpServers,
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['mcp-servers'] })

  const create = useMutation({
    mutationFn: createMcpServer,
    onSuccess: invalidate,
  })

  const update = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Omit<MCPServer, 'id' | 'created_at'>> }) =>
      updateMcpServer(id, data),
    onSuccess: invalidate,
  })

  const remove = useMutation({
    mutationFn: deleteMcpServer,
    onSuccess: invalidate,
  })

  return {
    mcpServers: Array.isArray(query.data) ? query.data : [],
    isLoading: query.isLoading,
    isError: query.isError,
    create: (data: Omit<MCPServer, 'id' | 'created_at'>) => create.mutate(data),
    update: (id: string, data: Partial<Omit<MCPServer, 'id' | 'created_at'>>) => update.mutate({ id, data }),
    remove: (id: string) => remove.mutate(id),
  }
}
