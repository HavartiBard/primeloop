import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchPortalState, updatePortalState } from '../api'
import type { PortalState } from '../types'

export function usePortalState() {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: ['portal-state'],
    queryFn: fetchPortalState,
  })

  const save = useMutation({
    mutationFn: updatePortalState,
    onSuccess: (state: PortalState) => {
      queryClient.setQueryData(['portal-state'], state)
    },
  })

  return {
    portalState: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    save: (state: PortalState) => save.mutate(state),
  }
}
