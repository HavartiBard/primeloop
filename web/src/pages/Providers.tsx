import { useState } from 'react'
import { useProviders } from '../hooks/useProviders'
import type { Provider } from '../types'

const TYPE_OPTIONS = ['openai', 'anthropic', 'ollama', 'litellm', 'other']

interface FormState {
  name: string
  type: string
  base_url: string
  api_key: string
}

const EMPTY_FORM: FormState = { name: '', type: 'openai', base_url: '', api_key: '' }

interface ModalProps {
  mode: 'add' | 'edit'
  provider?: Provider
  onClose: () => void
  onSubmit: (data: FormState) => void
}

function ProviderModal({ mode, provider, onClose, onSubmit }: ModalProps) {
  const [form, setForm] = useState<FormState>({
    name: provider?.name ?? '',
    type: provider?.type ?? 'openai',
    base_url: provider?.base_url ?? '',
    api_key: '',
  })

  const set = (field: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [field]: e.target.value }))

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSubmit(form)
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-gray-900 border border-gray-700 rounded-lg p-6 w-full max-w-md">
        <h2 className="text-sm font-semibold text-white mb-4">
          {mode === 'add' ? 'Add Provider' : 'Edit Provider'}
        </h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Name *</label>
            <input
              required
              value={form.name}
              onChange={set('name')}
              placeholder="e.g. openai-prod"
              className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-gray-400"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Type *</label>
            <select
              value={form.type}
              onChange={set('type')}
              className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-gray-400"
            >
              {TYPE_OPTIONS.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Base URL *</label>
            <input
              required
              value={form.base_url}
              onChange={set('base_url')}
              placeholder="https://api.openai.com/v1"
              className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-gray-400"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">API Key</label>
            <input
              type="password"
              value={form.api_key}
              onChange={set('api_key')}
              placeholder={mode === 'edit' ? 'leave blank to keep existing' : 'optional'}
              className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-gray-400"
            />
          </div>
          <div className="flex gap-2 mt-2 justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 text-xs bg-gray-800 border border-gray-600 text-gray-300 rounded hover:bg-gray-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-1.5 text-xs bg-blue-900 border border-blue-600 text-blue-300 rounded hover:bg-blue-800"
            >
              {mode === 'add' ? 'Add' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export function Providers() {
  const { providers, isLoading, isError, create, update, remove } = useProviders()
  const [modal, setModal] = useState<{ mode: 'add' | 'edit'; provider?: Provider } | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const handleSubmit = (form: FormState) => {
    const payload: Omit<Provider, 'id' | 'created_at'> = {
      name: form.name,
      type: form.type,
      base_url: form.base_url,
      ...(form.api_key ? { api_key: form.api_key } : {}),
    }
    if (modal?.mode === 'edit' && modal.provider) {
      update(modal.provider.id, payload)
    } else {
      create(payload)
    }
    setModal(null)
  }

  const handleDelete = (provider: Provider) => {
    if (deletingId === provider.id) {
      remove(provider.id)
      setDeletingId(null)
    } else {
      setDeletingId(provider.id)
    }
  }

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm text-gray-400">Providers</h2>
        <button
          onClick={() => setModal({ mode: 'add' })}
          className="px-3 py-1.5 text-xs bg-blue-900 border border-blue-600 text-blue-300 rounded hover:bg-blue-800"
        >
          + Add Provider
        </button>
      </div>

      {isError && <p className="text-red-400 text-sm mb-3">Failed to load providers.</p>}

      {isLoading ? (
        <p className="text-gray-500 text-sm">Loading…</p>
      ) : providers.length === 0 ? (
        <p className="text-gray-500 text-sm">No providers configured yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="text-gray-500 border-b border-gray-800">
                <th className="pb-2 pr-4 font-normal">Name</th>
                <th className="pb-2 pr-4 font-normal">Type</th>
                <th className="pb-2 pr-4 font-normal">Base URL</th>
                <th className="pb-2 pr-4 font-normal">API Key</th>
                <th className="pb-2 pr-4 font-normal">Created</th>
                <th className="pb-2 font-normal">Actions</th>
              </tr>
            </thead>
            <tbody>
              {providers.map((p) => (
                <tr key={p.id} className="border-b border-gray-800/50 hover:bg-gray-900/40">
                  <td className="py-2 pr-4 text-white font-mono">{p.name}</td>
                  <td className="py-2 pr-4 text-gray-300">{p.type}</td>
                  <td className="py-2 pr-4 text-gray-400 font-mono max-w-xs truncate">{p.base_url}</td>
                  <td className="py-2 pr-4 text-gray-400 font-mono">
                    {p.api_key ? '••••••' : <span className="text-gray-600">—</span>}
                  </td>
                  <td className="py-2 pr-4 text-gray-500">
                    {new Date(p.created_at).toLocaleDateString()}
                  </td>
                  <td className="py-2">
                    <div className="flex gap-2 items-center">
                      <button
                        onClick={() => setModal({ mode: 'edit', provider: p })}
                        className="px-2 py-1 text-xs bg-gray-800 border border-gray-600 text-gray-300 rounded hover:bg-gray-700"
                      >
                        Edit
                      </button>
                      {deletingId === p.id ? (
                        <>
                          <button
                            onClick={() => handleDelete(p)}
                            className="px-2 py-1 text-xs bg-red-900 border border-red-600 text-red-300 rounded hover:bg-red-800"
                          >
                            Confirm
                          </button>
                          <button
                            onClick={() => setDeletingId(null)}
                            className="px-2 py-1 text-xs bg-gray-800 border border-gray-600 text-gray-400 rounded hover:bg-gray-700"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => handleDelete(p)}
                          className="px-2 py-1 text-xs bg-gray-800 border border-red-800 text-red-400 rounded hover:bg-red-900/30"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <ProviderModal
          mode={modal.mode}
          provider={modal.provider}
          onClose={() => setModal(null)}
          onSubmit={handleSubmit}
        />
      )}
    </div>
  )
}
