import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchCatalogTemplates,
  fetchCatalogTemplate,
  fetchCatalogSources,
  syncCatalog,
  approveCatalogVersion,
  validateCatalogVersion,
  instantiateCatalogVersion,
  rollbackCatalogTemplate,
  deprecateCatalogTemplate,
  runCatalogMigrate,
  createCatalogSource,
} from '../api'

export function useTemplates() {
  return useQuery({
    queryKey: ['catalog-templates'],
    queryFn: fetchCatalogTemplates,
    staleTime: 30_000,
  })
}

export function useTemplate(id: string | null) {
  return useQuery({
    queryKey: ['catalog-template', id],
    queryFn: () => fetchCatalogTemplate(id!),
    enabled: id != null,
    staleTime: 15_000,
  })
}

export function useCatalogSources() {
  return useQuery({
    queryKey: ['catalog-sources'],
    queryFn: fetchCatalogSources,
    staleTime: 60_000,
  })
}

export function useSyncCatalog() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: syncCatalog,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['catalog-templates'] })
    },
  })
}

export function useValidateVersion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ templateId, version }: { templateId: string; version: string }) =>
      validateCatalogVersion(templateId, version),
    onSuccess: (_data, { templateId }) => {
      void qc.invalidateQueries({ queryKey: ['catalog-template', templateId] })
      void qc.invalidateQueries({ queryKey: ['catalog-templates'] })
    },
  })
}

export function useApproveVersion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ templateId, version, note }: { templateId: string; version: string; note?: string }) =>
      approveCatalogVersion(templateId, version, note),
    onSuccess: (_data, { templateId }) => {
      void qc.invalidateQueries({ queryKey: ['catalog-template', templateId] })
      void qc.invalidateQueries({ queryKey: ['catalog-templates'] })
    },
  })
}

export function useInstantiateVersion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ templateId, version, name }: { templateId: string; version: string; name?: string }) =>
      instantiateCatalogVersion(templateId, version, name ? { name } : undefined),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['catalog-templates'] })
    },
  })
}

export function useRollbackTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ templateId, version }: { templateId: string; version: string }) =>
      rollbackCatalogTemplate(templateId, version),
    onSuccess: (_data, { templateId }) => {
      void qc.invalidateQueries({ queryKey: ['catalog-template', templateId] })
      void qc.invalidateQueries({ queryKey: ['catalog-templates'] })
    },
  })
}

export function useDeprecateTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (templateId: string) => deprecateCatalogTemplate(templateId),
    onSuccess: (_data, templateId) => {
      void qc.invalidateQueries({ queryKey: ['catalog-template', templateId] })
      void qc.invalidateQueries({ queryKey: ['catalog-templates'] })
    },
  })
}

export function useMigrate() {
  return useMutation({
    mutationFn: (write: boolean) => runCatalogMigrate(write),
  })
}

export function useCreateCatalogSource() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: createCatalogSource,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['catalog-sources'] })
    },
  })
}
