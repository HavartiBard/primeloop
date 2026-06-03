# Fix: ACP permission approval round-trip

**Files to change**: `backend/src/acp/permission.ts`, `backend/src/routes/approvals.ts`, `backend/tests/acp/permission.test.ts`

## The problem

`PermissionPolicy.resolvePermission()` parks a sensitive ACP permission request in `this.pendingPermissions` and creates an approval-queue item. Nothing ever calls `handleApprovalDecision()` when an operator decides — the only resolution path is the fail-safe timeout deny. `handleApprovalDecision` also has a bug on line 106: it retrieves `options` as an empty array so it can never find the right `optionId`.

## Fix 1 — store options with the pending entry (`permission.ts`)

Add `options` to the `pendingPermissions` map value type and populate it in `resolvePermission`:

```ts
private pendingPermissions = new Map<string, {
  resolve: (result: SessionRequestPermissionResult) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
  options: { optionId: string; name: string; kind: string }[];
}>()
```

In `resolvePermission`, when calling `this.pendingPermissions.set(approvalId, ...)`, include `options` from the request.

In `handleApprovalDecision`, delete the broken line and use `pending.options` instead.

## Fix 2 — module-level registry (`permission.ts`)

Add a module-level map so routes can look up the right policy instance by `approvalId`:

```ts
const approvalRegistry = new Map<string, { policy: PermissionPolicy; context: PermissionContext }>()

export function lookupApprovalPolicy(approvalId: string) {
  return approvalRegistry.get(approvalId)
}
```

In `resolvePermission`: call `approvalRegistry.set(approvalId, { policy: this, context })` before returning the Promise.

In `handleApprovalDecision`, `cancelPendingPermissions`, and the timeout callback: call `approvalRegistry.delete(approvalId)` when resolving/cancelling.

## Fix 3 — call `handleApprovalDecision` from the approve/deny routes (`approvals.ts`)

After `decideApproval()` in both `/:id/approve` and `/:id/deny`:

```ts
import { lookupApprovalPolicy } from '../acp/permission.js'

const acpEntry = lookupApprovalPolicy(approval.approval_id)
if (acpEntry) {
  await acpEntry.policy.handleApprovalDecision(approval.approval_id, 'approved', acpEntry.context)
  // or 'denied'
}
```

The `if (acpEntry)` guard means non-ACP approvals are unaffected.

## Fix 4 — tests (`permission.test.ts`)

Add two tests for the approve and deny paths. Capture the `approvalId` by reading the argument passed to the `ensurePendingApproval` mock, then call `handleApprovalDecision` directly:

- approve: resolves `{ outcome: 'selected', optionId: <allow_once id> }`
- deny: resolves `{ outcome: 'selected', optionId: <reject_once id> }`

## Verify

```sh
npm run test -- tests/acp/permission.test.ts tests/fleet-executor/
```

All tests must pass. Do not touch anything outside the three listed files.
