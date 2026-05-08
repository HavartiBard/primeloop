import { useState } from 'react'
import { useMcpServers } from '../hooks/useMcpServers'
import type { MCPServer } from '../types'

interface McpServerFormState {
  name: string
  description: string
  type: 'http' | 'stdio'
  url: string
  command: string
  args_csv: string
  env_vars_json: string
}

const EMPTY_FORM: McpServerFormState = {
  name: '',
  description: '',
  type: 'http',
  url: '',
  command: '',
  args_csv: '',
  env_vars_json: '{}',
}

function McpServerModal({ mode, server, onClose, onSubmit }: {
  mode: 'add' | 'edit'
  server?: MCPServer
  onClose: () => void
  onSubmit: (data: McpServerFormState) => void
}) {
  const [form, setForm] = useState<McpServerFormState>({
    name: server?.name ?? '',
    description: server?.description ?? '',
    type: server?.type ?? 'http',
    url: server?.url ?? '',
    command: server?.command ?? '',
    args_csv: server?.args?.join(', ') ?? '',
    env_vars_json: server?.env_vars ? JSON.stringify(server.env_vars, null, 2) : '{}',
  })
  const [jsonError, setJsonError] = useState<string | null>(null)

  const setField =
    (field: keyof McpServerFormState) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm((current) => ({ ...current, [field]: e.target.value }))

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    try {
      JSON.parse(form.env_vars_json)
    } catch {
      setJsonError('Env vars JSON is not valid JSON')
      return
    }
    setJsonError(null)
    onSubmit(form)
  }

  const inputCls = 'w-full bg-[var(--panel-subtle)] border border-[var(--border-soft)] rounded px-3 py-2 text-sm text-[var(--text)] placeholder-[var(--muted)] focus:outline-none focus:border-[var(--sel-bd)]'
  const labelCls = 'block text-xs text-[var(--muted)] mb-1'

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-[var(--panel)] border border-[var(--border-soft)] rounded-lg p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <h2 className="text-sm font-semibold text-[var(--text)] mb-4">
          {mode === 'add' ? 'Add MCP Server' : 'Edit MCP Server'}
        </h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div>
            <label className={labelCls}>Name *</label>
            <input required value={form.name} onChange={setField('name')} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Description</label>
            <input value={form.description} onChange={setField('description')} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Type *</label>
            <select value={form.type} onChange={setField('type')} className={inputCls}>
              <option value="http">http</option>
              <option value="stdio">stdio</option>
            </select>
          </div>
          {form.type === 'http' ? (
            <div>
              <label className={labelCls}>URL *</label>
              <input required value={form.url} onChange={setField('url')} className={inputCls} placeholder="http://service:3000/mcp" />
            </div>
          ) : (
            <>
              <div>
                <label className={labelCls}>Command *</label>
                <input required value={form.command} onChange={setField('command')} className={inputCls} placeholder="node" />
              </div>
              <div>
                <label className={labelCls}>Args (comma-separated)</label>
                <input value={form.args_csv} onChange={setField('args_csv')} className={inputCls} placeholder="dist/server.js, --flag" />
              </div>
            </>
          )}
          <div>
            <label className={labelCls}>Env Vars JSON</label>
            <textarea value={form.env_vars_json} onChange={setField('env_vars_json')} rows={6} className={`${inputCls} font-mono resize-y`} />
            {jsonError && <p className="text-[var(--s-blk-tx)] text-xs mt-1">{jsonError}</p>}
          </div>
          <div className="flex gap-2 mt-2 justify-end">
            <button type="button" onClick={onClose}
              className="px-4 py-1.5 text-xs bg-[var(--panel-subtle)] border border-[var(--border-soft)] text-[var(--muted)] rounded hover:bg-[var(--panel)]">
              Cancel
            </button>
            <button type="submit"
              className="px-4 py-1.5 text-xs bg-[var(--sel-bg)] border border-[var(--sel-bd)] text-blue-400 rounded hover:bg-blue-500/20">
              {mode === 'add' ? 'Add' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export function McpServers() {
  const { mcpServers, isLoading, isError, create, update, remove } = useMcpServers()
  const [modal, setModal] = useState<{ mode: 'add' | 'edit'; server?: MCPServer } | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const handleSubmit = (form: McpServerFormState) => {
    const payload: Omit<MCPServer, 'id' | 'created_at'> = {
      name: form.name,
      description: form.description || undefined,
      type: form.type,
      ...(form.type === 'http' ? { url: form.url } : { command: form.command }),
      ...(form.type === 'stdio' && form.args_csv.trim()
        ? { args: form.args_csv.split(',').map((item) => item.trim()).filter(Boolean) }
        : {}),
      env_vars: JSON.parse(form.env_vars_json),
    }

    if (modal?.mode === 'edit' && modal.server) {
      update(modal.server.id, payload)
    } else {
      create(payload)
    }
    setModal(null)
  }

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm text-[var(--muted)]">MCP Registry</h2>
        <button onClick={() => setModal({ mode: 'add' })}
          className="px-3 py-1.5 text-xs bg-[var(--sel-bg)] border border-[var(--sel-bd)] text-blue-400 rounded hover:bg-blue-500/20">
          + Add MCP Server
        </button>
      </div>

      {isError && <p className="text-[var(--s-blk-tx)] text-sm mb-3">Failed to load MCP servers.</p>}
      {isLoading ? (
        <p className="text-[var(--muted)] text-sm">Loading…</p>
      ) : mcpServers.length === 0 ? (
        <p className="text-[var(--muted)] text-sm">No MCP servers registered yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="text-[var(--muted)] border-b border-[var(--border-soft)]">
                <th className="pb-2 pr-4 font-normal">Name</th>
                <th className="pb-2 pr-4 font-normal">Type</th>
                <th className="pb-2 pr-4 font-normal">Endpoint</th>
                <th className="pb-2 pr-4 font-normal">Env Vars</th>
                <th className="pb-2 font-normal">Actions</th>
              </tr>
            </thead>
            <tbody>
              {mcpServers.map((server) => (
                <tr key={server.id} className="border-b border-[var(--border-soft)]/50 hover:bg-[var(--panel-subtle)]">
                  <td className="py-2 pr-4">
                    <div className="font-mono text-[var(--text)]">{server.name}</div>
                    {server.description && <div className="text-[11px] text-[var(--muted)]">{server.description}</div>}
                  </td>
                  <td className="py-2 pr-4 text-[var(--muted)]">{server.type}</td>
                  <td className="py-2 pr-4 text-[var(--muted)] font-mono max-w-[240px] truncate">
                    {server.type === 'http' ? (server.url ?? '—') : `${server.command ?? '—'} ${server.args?.join(' ') ?? ''}`}
                  </td>
                  <td className="py-2 pr-4 text-[var(--muted)] font-mono">
                    {server.env_vars && Object.keys(server.env_vars).length > 0
                      ? Object.entries(server.env_vars).map(([key, value]) => `${key}=${value}`).join(', ')
                      : <span className="opacity-40">—</span>}
                  </td>
                  <td className="py-2">
                    <div className="flex gap-1.5 items-center flex-wrap">
                      <button onClick={() => setModal({ mode: 'edit', server })}
                        className="px-2 py-1 text-xs bg-[var(--panel-subtle)] border border-[var(--border-soft)] text-[var(--muted)] rounded hover:bg-[var(--panel)]">
                        Edit
                      </button>
                      {deletingId === server.id ? (
                        <>
                          <button onClick={() => { remove(server.id); setDeletingId(null) }}
                            className="px-2 py-1 text-xs bg-[var(--s-blk-bg)] border border-[var(--s-blk-bd)] text-[var(--s-blk-tx)] rounded">
                            Confirm
                          </button>
                          <button onClick={() => setDeletingId(null)}
                            className="px-2 py-1 text-xs bg-[var(--panel-subtle)] border border-[var(--border-soft)] text-[var(--muted)] rounded">
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button onClick={() => setDeletingId(server.id)}
                          className="px-2 py-1 text-xs bg-[var(--panel-subtle)] border border-[var(--s-blk-bd)]/60 text-[var(--s-blk-tx)] rounded hover:bg-[var(--s-blk-bg)]">
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
        <McpServerModal
          mode={modal.mode}
          server={modal.server}
          onClose={() => setModal(null)}
          onSubmit={handleSubmit}
        />
      )}
    </div>
  )
}
