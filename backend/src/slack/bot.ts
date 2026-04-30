import { App } from '@slack/bolt'

interface ApprovalMessageInput {
  approvalId: string
  runId: string
  action: string
}

export function buildApprovalMessage(input: ApprovalMessageInput): object[] {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `🔔 *Approval required*\n*Action:* \`${input.action}\`\n*Run:* \`${input.runId}\``,
      },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '✓ Approve' },
          style: 'primary',
          action_id: `approve:${input.approvalId}`,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '✕ Deny' },
          style: 'danger',
          action_id: `deny:${input.approvalId}`,
        },
      ],
    },
  ]
}

interface SlackBotDeps {
  botToken: string
  appToken: string
  channelId: string
  onApprove: (approvalId: string) => Promise<void>
  onDeny: (approvalId: string) => Promise<void>
}

export function createSlackBot(deps: SlackBotDeps): App {
  const app = new App({
    token: deps.botToken,
    appToken: deps.appToken,
    socketMode: true,
  })

  app.action(/^approve:(.+)$/, async ({ action, ack, client, body }) => {
    await ack()
    const approvalId = (action as { action_id: string }).action_id.split(':')[1]
    await deps.onApprove(approvalId)
    await client.chat.update({
      channel: (body as { channel?: { id: string } }).channel?.id ?? deps.channelId,
      ts: (body as { message?: { ts: string } }).message?.ts ?? '',
      text: `✓ Approved \`${approvalId}\``,
      blocks: [],
    })
  })

  app.action(/^deny:(.+)$/, async ({ action, ack, client, body }) => {
    await ack()
    const approvalId = (action as { action_id: string }).action_id.split(':')[1]
    await deps.onDeny(approvalId)
    await client.chat.update({
      channel: (body as { channel?: { id: string } }).channel?.id ?? deps.channelId,
      ts: (body as { message?: { ts: string } }).message?.ts ?? '',
      text: `✕ Denied \`${approvalId}\``,
      blocks: [],
    })
  })

  return app
}

export async function notifyApprovalNeeded(
  app: App,
  channelId: string,
  input: ApprovalMessageInput
): Promise<void> {
  await app.client.chat.postMessage({
    channel: channelId,
    text: `Approval needed: ${input.action} (run ${input.runId})`,
    blocks: buildApprovalMessage(input),
  })
}
