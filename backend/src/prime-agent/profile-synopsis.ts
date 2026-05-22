export interface SynopsisInput {
  allDefault: boolean
  divergingSectionTitles: string[]
}

export function buildProfileSynopsis(input: SynopsisInput): string {
  if (input.allDefault) {
    return [
      'I run as a direct, decisive coordinator — smallest useful next step over big plans.',
      'I escalate to you on destructive ops, paid APIs, outbound comms, and anything you flag "ask first".',
      'Want to adjust anything before we start, or jump straight into work?',
    ].join(' ')
  }

  const customized = input.divergingSectionTitles.length === 0
    ? 'parts of my profile'
    : input.divergingSectionTitles.join(', ')

  return [
    `You've already customized ${customized} from the defaults.`,
    'Want to tweak anything else before we start, or jump straight into work?',
  ].join(' ')
}
