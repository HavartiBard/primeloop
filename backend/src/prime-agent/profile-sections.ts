export type ProfileFile = 'soul' | 'operating'

export type SoulSectionKey = 'identity' | 'voice_tone' | 'decision_style'
export type OperatingSectionKey = 'default_behaviors' | 'approval_thresholds'
export type SectionKey = SoulSectionKey | OperatingSectionKey

export const SOUL_SECTION_KEYS: SoulSectionKey[] = ['identity', 'voice_tone', 'decision_style']
export const OPERATING_SECTION_KEYS: OperatingSectionKey[] = ['default_behaviors', 'approval_thresholds']

interface SectionDef {
  file: ProfileFile
  heading: string
}

export const SECTION_DEFS: Record<SectionKey, SectionDef> = {
  identity:            { file: 'soul',      heading: 'Identity' },
  voice_tone:          { file: 'soul',      heading: 'Voice & Tone' },
  decision_style:      { file: 'soul',      heading: 'Decision Style' },
  default_behaviors:   { file: 'operating', heading: 'Default Behaviors' },
  approval_thresholds: { file: 'operating', heading: 'Approval Thresholds' },
}

const HEADING_TO_KEY: Map<string, SectionKey> = new Map(
  (Object.entries(SECTION_DEFS) as [SectionKey, SectionDef][]).map(
    ([key, def]) => [def.heading.toLowerCase(), key],
  ),
)

export type ProfileSections = Partial<Record<SectionKey, string>>

export interface ParsedProfile {
  sections: ProfileSections
  unknown: Array<{ heading: string; body: string }>
}

export function parseProfileSections(markdown: string, file: ProfileFile): ParsedProfile {
  const sections: ProfileSections = {}
  const unknown: Array<{ heading: string; body: string }> = []
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')

  let currentHeading: string | null = null
  let currentKey: SectionKey | null = null
  let buffer: string[] = []

  const flush = () => {
    if (currentHeading === null) return
    const body = buffer.join('\n').replace(/^\n+|\n+$/g, '')
    if (currentKey !== null && SECTION_DEFS[currentKey].file === file) {
      sections[currentKey] = body
    } else {
      // Either an unknown heading or a heading that belongs to the other file —
      // both are treated as unknown for this file so they are preserved verbatim.
      unknown.push({ heading: currentHeading, body })
    }
    buffer = []
  }

  for (const line of lines) {
    const match = /^##\s+(.+?)\s*$/.exec(line)
    if (match) {
      flush()
      currentHeading = match[1].trim()
      currentKey = HEADING_TO_KEY.get(currentHeading.toLowerCase()) ?? null
      continue
    }
    if (currentHeading !== null) {
      buffer.push(line)
    }
  }
  flush()

  // Ensure all known keys for this file have at least an empty string
  const knownKeys: SectionKey[] = file === 'soul' ? SOUL_SECTION_KEYS : OPERATING_SECTION_KEYS
  for (const key of knownKeys) {
    if (!(key in sections)) {
      sections[key] = ''
    }
  }

  return { sections, unknown }
}

export function renderProfileSections(file: ProfileFile, parsed: ParsedProfile): string {
  const orderedKeys: SectionKey[] = file === 'soul' ? SOUL_SECTION_KEYS : OPERATING_SECTION_KEYS
  const blocks: string[] = []

  for (const key of orderedKeys) {
    const body = parsed.sections[key]?.trim()
    if (!body) continue
    blocks.push(`## ${SECTION_DEFS[key].heading}\n${body}`)
  }

  for (const entry of parsed.unknown) {
    const body = entry.body.trim()
    if (!body) continue
    blocks.push(`## ${entry.heading}\n${body}`)
  }

  return blocks.length === 0 ? '' : `${blocks.join('\n\n')}\n`
}

export function sectionKeyFromHeading(heading: string): SectionKey | undefined {
  return HEADING_TO_KEY.get(heading.toLowerCase())
}
