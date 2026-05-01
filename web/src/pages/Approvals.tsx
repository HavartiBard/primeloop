import { ApprovalQueue } from '../components/ApprovalQueue'
import { useApprovals } from '../hooks/useApprovals'

export function Approvals() {
  const { approvals, approve, deny } = useApprovals()
  return <ApprovalQueue approvals={approvals} onApprove={approve} onDeny={deny} />
}
