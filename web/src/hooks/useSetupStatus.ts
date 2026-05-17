import { useQuery } from '@tanstack/react-query'

export function useSetupStatus() {
  return useQuery({
    queryKey: ['setup-status'],
    queryFn: () =>
      fetch('/api/setup/status').then((r) => r.json()) as Promise<{ complete: boolean }>,
    staleTime: Infinity,
  })
}
