import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchPendingApprovals, approveAction, denyAction } from '../api'

export function useApprovals() {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: ['approvals', 'pending'],
    queryFn: fetchPendingApprovals,
    refetchInterval: 10_000,
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['approvals'] })

  const approve = useMutation({ mutationFn: approveAction, onSuccess: invalidate })
  const deny = useMutation({ mutationFn: denyAction, onSuccess: invalidate })

  return {
    approvals: query.data ?? [],
    isLoading: query.isLoading,
    approve: (id: string) => approve.mutate(id),
    deny: (id: string) => deny.mutate(id),
  }
}
