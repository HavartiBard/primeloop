import { useQuery } from '@tanstack/react-query'
import { getApiOrigin } from '../api'

export function useSetupStatus() {
  return useQuery({
    queryKey: ['setup-status'],
    queryFn: () =>
      fetch(`${getApiOrigin()}/api/setup/status`).then((r) => r.json()) as Promise<{ complete: boolean }>,
    staleTime: Infinity,
  })
}
