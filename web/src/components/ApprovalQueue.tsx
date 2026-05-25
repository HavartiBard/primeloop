import type { Approval } from '../types'

interface Props {
  approvals: Approval[]
  onApprove: (id: string) => void
  onDeny: (id: string) => void
}

export function ApprovalQueue({ approvals, onApprove, onDeny }: Props) {
  if (approvals.length === 0) {
    return <p className="text-gray-500 text-sm p-4">No pending approvals</p>
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      {approvals.map((a) => (
        <div key={a.approval_id} className="bg-gray-900 border border-red-800 rounded p-4">
          <div className="text-red-400 font-semibold text-sm mb-2">
            {a.action}
          </div>
          <div className="text-gray-500 text-xs mb-3">requested {new Date(a.created_at).toLocaleString()}</div>
          <div className="flex gap-2">
            <button
              onClick={() => onApprove(a.approval_id)}
              className="px-3 py-1 text-xs bg-green-900 border border-green-600 text-green-300 rounded hover:bg-green-800"
            >
              ✓ Approve
            </button>
            <button
              onClick={() => onDeny(a.approval_id)}
              className="px-3 py-1 text-xs bg-red-900 border border-red-600 text-red-300 rounded hover:bg-red-800"
            >
              ✕ Deny
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
