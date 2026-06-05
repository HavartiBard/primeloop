import { useQuery } from '@tanstack/react-query'
import { fetchSetupStatus } from '../api'

export function useSetupStatus() {
  return useQuery({
    queryKey: ['setup-status'],
    queryFn: fetchSetupStatus,
    staleTime: Infinity,
  })
}
