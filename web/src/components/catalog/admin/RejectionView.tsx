// Rejection view for catalog templates — Tailwind implementation

import type { FailureReason } from '../../../types/catalog.js'

const FAILURE_LABELS: Record<string, string> = {
  MISSING_REQUIRED_FIELD:    'Missing required field',
  INVALID_FIELD_TYPE:        'Invalid field type',
  UNKNOWN_RUNTIME_FAMILY:    'Unknown runtime family',
  UNKNOWN_CAPABILITY_BUNDLE: 'Unknown capability bundle',
  UNKNOWN_PLATFORM_PRIMITIVE:'Unknown platform primitive',
  UNKNOWN_MCP_SERVER:        'Unknown MCP server',
  UNKNOWN_CREDENTIAL:        'Unknown credential',
  UNKNOWN_PROVIDER:          'Unknown provider',
  LEAST_PRIVILEGE_VIOLATION: 'Least privilege violation',
  DUPLICATE_TEMPLATE_ID:     'Duplicate template ID',
  VERSION_CONFLICT:          'Version conflict',
  SECRET_VALUE_PRESENT:      'Potential secret detected',
  APPROVAL_POLICY_DOWNGRADED:'Approval policy downgraded',
}

const HIGH_SEVERITY = new Set(['LEAST_PRIVILEGE_VIOLATION', 'SECRET_VALUE_PRESENT'])

interface RejectionViewProps {
  templateId: string
  version: string
  failureReasons: FailureReason[]
}

export function RejectionView({ templateId, version, failureReasons }: RejectionViewProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="rounded border border-rose-400/30 bg-rose-400/10 px-2 py-0.5 text-xs font-medium text-rose-300">
          {failureReasons.length} failure{failureReasons.length !== 1 ? 's' : ''}
        </span>
        <span className="font-mono text-xs text-[var(--muted)]">
          {templateId}@{version}
        </span>
      </div>
      <div className="space-y-1.5">
        {failureReasons.map((r, i) => {
          const high = HIGH_SEVERITY.has(r.code)
          return (
            <div
              key={i}
              className={`rounded border px-3 py-2 text-xs ${
                high
                  ? 'border-amber-400/30 bg-amber-400/5'
                  : 'border-rose-400/20 bg-rose-400/5'
              }`}
            >
              <span className={`font-medium ${high ? 'text-amber-300' : 'text-rose-300'}`}>
                {FAILURE_LABELS[r.code] ?? r.code}
              </span>
              {r.field && (
                <span className="ml-1.5 font-mono text-[var(--muted)]">{r.field}</span>
              )}
              {r.detail && (
                <p className="mt-0.5 text-[var(--muted)]">{r.detail}</p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default RejectionView
