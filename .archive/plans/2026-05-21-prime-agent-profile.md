# Prime Agent Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a robust, structured default Prime profile (Identity, Voice & Tone, Decision Style, Default Behaviors, Approval Thresholds) split across `agents/prime-soul.md` and `agents/prime.md`, exposed for section-by-section editing in the setup wizard and conversational refinement in the onboarding thread via a new `update_profile` action.

**Architecture:** Workspace markdown files are the source of truth. A parser splits `## Section` headings into named keys; a renderer writes them back. Profile changes flow through a new HTTP API (`/api/prime-agent/profile`) and through Prime's new `update_profile` action; both share the same render-and-write path. The `chief_profiles.persona` column continues to hold rendered text (concatenated soul + operating) for backward-compat with the existing LLM-router fallback.

**Tech Stack:** TypeScript, Express, Vitest (backend), React + Vitest + Testing Library (frontend), Postgres (no schema migration required).

**Spec:** `docs/superpowers/specs/2026-05-21-prime-agent-profile-design.md`

---

## Task 1: Profile parser/renderer + section constants (TDD)

**Files:**
- Create: `backend/src/prime-agent/profile-sections.ts`
- Create: `backend/tests/prime-agent/profile-sections.test.ts`

The parser is the foundation everything else builds on. Build it first with full TDD coverage.

- [ ] **Step 1: Create the test file with failing tests**

Create `backend/tests/prime-agent/profile-sections.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  parseProfileSections,
  renderProfileSections,
  SOUL_SECTION_KEYS,
  OPERATING_SECTION_KEYS,
  type ProfileSections,
} from '../../src/prime-agent/profile-sections.js'

describe('parseProfileSections — soul', () => {
  it('parses all three soul sections', () => {
    const md = [
      '# Prime — Soul',
      '',
      '## Identity',
      'I am Prime.',
      '',
      '## Voice & Tone',
      '- Direct.',
      '- Concise.',
      '',
      '## Decision Style',
      'Smallest useful step first.',
      '',
    ].join('\n')

    const parsed = parseProfileSections(md, 'soul')
    expect(parsed.sections.identity).toBe('I am Prime.')
    expect(parsed.sections.voice_tone).toBe('- Direct.\n- Concise.')
    expect(parsed.sections.decision_style).toBe('Smallest useful step first.')
    expect(parsed.unknown).toEqual([])
  })

  it('returns empty string for missing sections', () => {
    const md = '# Prime — Soul\n\n## Identity\nI am Prime.\n'
    const parsed = parseProfileSections(md, 'soul')
    expect(parsed.sections.identity).toBe('I am Prime.')
    expect(parsed.sections.voice_tone).toBe('')
    expect(parsed.sections.decision_style).toBe('')
  })

  it('matches section headings case-insensitively', () => {
    const md = '## identity\nlower\n## VOICE & TONE\nupper'
    const parsed = parseProfileSections(md, 'soul')
    expect(parsed.sections.identity).toBe('lower')
    expect(parsed.sections.voice_tone).toBe('upper')
  })

  it('preserves unknown headings verbatim', () => {
    const md = '## Identity\nI am Prime.\n\n## Custom Section\nCustom body.\n'
    const parsed = parseProfileSections(md, 'soul')
    expect(parsed.sections.identity).toBe('I am Prime.')
    expect(parsed.unknown).toEqual([
      { heading: 'Custom Section', body: 'Custom body.' },
    ])
  })

  it('tolerates CRLF and extra blank lines', () => {
    const md = '## Identity\r\n\r\n\r\nI am Prime.\r\n\r\n## Voice & Tone\r\nBrief.\r\n'
    const parsed = parseProfileSections(md, 'soul')
    expect(parsed.sections.identity).toBe('I am Prime.')
    expect(parsed.sections.voice_tone).toBe('Brief.')
  })
})

describe('parseProfileSections — operating', () => {
  it('parses both operating sections', () => {
    const md = [
      '## Default Behaviors',
      '- I report outcomes.',
      '',
      '## Approval Thresholds',
      '**Always escalate:** destructive ops.',
      '',
    ].join('\n')
    const parsed = parseProfileSections(md, 'operating')
    expect(parsed.sections.default_behaviors).toBe('- I report outcomes.')
    expect(parsed.sections.approval_thresholds).toBe('**Always escalate:** destructive ops.')
  })

  it('ignores soul headings when parsing operating', () => {
    const md = '## Identity\nignored\n\n## Default Behaviors\nkept'
    const parsed = parseProfileSections(md, 'operating')
    expect(parsed.sections.default_behaviors).toBe('kept')
    expect(parsed.unknown).toEqual([{ heading: 'Identity', body: 'ignored' }])
  })
})

describe('renderProfileSections', () => {
  it('renders sections in canonical order', () => {
    const sections: ProfileSections = {
      voice_tone: 'Direct.',
      identity: 'I am Prime.',
      decision_style: 'Small steps.',
    }
    const md = renderProfileSections('soul', { sections, unknown: [] })
    expect(md).toBe(
      '## Identity\nI am Prime.\n\n## Voice & Tone\nDirect.\n\n## Decision Style\nSmall steps.\n'
    )
  })

  it('skips empty sections', () => {
    const sections: ProfileSections = { identity: 'I am Prime.', voice_tone: '', decision_style: '' }
    const md = renderProfileSections('soul', { sections, unknown: [] })
    expect(md).toBe('## Identity\nI am Prime.\n')
  })

  it('appends unknown sections at the end', () => {
    const md = renderProfileSections('soul', {
      sections: { identity: 'core' },
      unknown: [{ heading: 'Custom', body: 'extra' }],
    })
    expect(md).toBe('## Identity\ncore\n\n## Custom\nextra\n')
  })

  it('round-trips parse → render → parse', () => {
    const original = '## Identity\nI am Prime.\n\n## Voice & Tone\nDirect.\n\n## Custom\nExtra.\n'
    const parsed = parseProfileSections(original, 'soul')
    const rendered = renderProfileSections('soul', parsed)
    const reparsed = parseProfileSections(rendered, 'soul')
    expect(reparsed.sections).toEqual(parsed.sections)
    expect(reparsed.unknown).toEqual(parsed.unknown)
  })
})

describe('section key constants', () => {
  it('exposes the soul keys in canonical order', () => {
    expect(SOUL_SECTION_KEYS).toEqual(['identity', 'voice_tone', 'decision_style'])
  })

  it('exposes the operating keys in canonical order', () => {
    expect(OPERATING_SECTION_KEYS).toEqual(['default_behaviors', 'approval_thresholds'])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx vitest run tests/prime-agent/profile-sections.test.ts`
Expected: FAIL — module `../../src/prime-agent/profile-sections.js` not found.

- [ ] **Step 3: Implement the module**

Create `backend/src/prime-agent/profile-sections.ts`:

```ts
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
    } else if (currentKey === null) {
      unknown.push({ heading: currentHeading, body })
    }
    // sections that map to the *other* file are silently dropped — they
    // don't belong here. The wizard never moves a key between files, so
    // this only happens if a user wrote the wrong heading by hand.
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx vitest run tests/prime-agent/profile-sections.test.ts`
Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
git add backend/src/prime-agent/profile-sections.ts backend/tests/prime-agent/profile-sections.test.ts
git commit -m "feat(prime): add profile section parser and renderer"
```

---

## Task 2: Ship the rich default templates

**Files:**
- Modify: `backend/prompts/agents/prime.md`
- Create: `backend/prompts/agents/prime-soul.md`
- Create: `backend/tests/prime-agent/profile-defaults.test.ts`

The default markdown templates need to round-trip cleanly through the parser. Drive the content with a parser-based integration test.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/prime-agent/profile-defaults.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  parseProfileSections,
  SOUL_SECTION_KEYS,
  OPERATING_SECTION_KEYS,
} from '../../src/prime-agent/profile-sections.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PROMPTS = path.resolve(HERE, '../../prompts/agents')

describe('shipped prime soul default', () => {
  it('parses cleanly with all soul sections populated and no unknown headings', async () => {
    const md = await fs.readFile(path.join(PROMPTS, 'prime-soul.md'), 'utf8')
    const parsed = parseProfileSections(md, 'soul')
    expect(parsed.unknown).toEqual([])
    for (const key of SOUL_SECTION_KEYS) {
      expect(parsed.sections[key], `section ${key} is empty`).toBeTruthy()
      expect((parsed.sections[key] ?? '').length).toBeGreaterThan(50)
    }
  })
})

describe('shipped prime operating default', () => {
  it('parses cleanly with all operating sections populated and no unknown headings', async () => {
    const md = await fs.readFile(path.join(PROMPTS, 'prime.md'), 'utf8')
    const parsed = parseProfileSections(md, 'operating')
    expect(parsed.unknown).toEqual([])
    for (const key of OPERATING_SECTION_KEYS) {
      expect(parsed.sections[key], `section ${key} is empty`).toBeTruthy()
      expect((parsed.sections[key] ?? '').length).toBeGreaterThan(50)
    }
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx vitest run tests/prime-agent/profile-defaults.test.ts`
Expected: FAIL — file `prime-soul.md` doesn't exist OR sections empty.

- [ ] **Step 3: Create the rich soul template**

Create `backend/prompts/agents/prime-soul.md`:

```markdown
# Prime — Soul

## Identity
I'm Prime, the coordination layer for this agent control plane. My job is to take user
intent, decide whether to act directly or delegate, and keep the user oriented on what
is actually happening. I am not the implementer — I am the orchestrator. When I
delegate, I own the outcome; I do not hand off and forget.

## Voice & Tone
- Direct, concrete, and grounded in progress that already happened or is about to happen.
- Short sentences over long ones. The user's terminology over generic AI phrasing.
- I do not acknowledge work — I do it, delegate it, or explain why I can't.
- When uncertain, I say so plainly. I do not hedge with disclaimers.
- I never narrate internal deliberation; I report decisions and their outcomes.

## Decision Style
- Smallest useful next step over comprehensive upfront plans.
- Fast feedback loops over careful design when the move is reversible.
- For reversible moves I pick one reasonable option and proceed.
- For irreversible moves I pause and confirm.
- I batch independent operations into parallel work whenever I can.
- I trust the conversation context and memory before re-exploring the codebase.
```

- [ ] **Step 4: Replace the operating template**

Overwrite `backend/prompts/agents/prime.md`:

```markdown
# Prime — Operating Profile

## Default Behaviors
- When the user gives me a task, I evaluate the smallest delegation that completes it.
- Every delegation becomes a tracked work item with an owner, scope, and verification step.
- I surface blocked, stale, or pending-approval items proactively — not when asked.
- I report outcomes, not progress: "Tests pass on branch X" beats "I'm running tests."
- I use the active thread as the coordination surface; I do not spin up new threads for
  the same goal.

## Approval Thresholds
These categories need explicit human approval, whether I am about to take the action
myself or a delegate is asking me to authorize it.

**Always escalate to the human:**
- Destructive operations on user data, branches, or shared infrastructure.
- Spending against external budgets (paid APIs, third-party services).
- Outbound communication to humans outside this control plane (emails, PR comments,
  customer-facing replies).
- Actions the user has flagged "ask first" in standing rules.

**I can auto-approve for delegates:**
- Read-only operations and verification commands.
- File edits within the scope listed in the delegation.
- Tool calls the delegation explicitly pre-authorized.
- Re-runs of a previously-approved action with the same scope.

If a request lands in the gray zone between these lists, I escalate.
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd backend && npx vitest run tests/prime-agent/profile-defaults.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/prompts/agents/prime-soul.md backend/prompts/agents/prime.md backend/tests/prime-agent/profile-defaults.test.ts
git commit -m "feat(prime): ship rich default soul and operating templates"
```

---

## Task 3: Workspace loader recognizes both files

**Files:**
- Modify: `backend/src/workspace.ts:55-65` (`TEMPLATE_PATHS`)
- Modify: `backend/src/workspace.ts:233-258` (`loadPrimeWorkspaceTemplates`)
- Modify: `backend/src/workspace.ts:320-339` (`keyToFallbackPath`)
- Modify: `backend/tests/workspace.test.ts` (or add to existing — verify by greping first)

Add `primeSoul` to the template paths so the runtime can load both files.

- [ ] **Step 1: Find or create the workspace test file**

Run: `cd backend && ls tests/workspace*.test.ts 2>/dev/null`

If a file exists, append to it. If not, create `backend/tests/workspace.test.ts`. The next step assumes the file exists; if not, you'll write a new test file with the necessary imports.

- [ ] **Step 2: Add failing test for the new template key**

Append to `backend/tests/workspace.test.ts` (or create it with appropriate imports):

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import pg from 'pg'
import { createPool, runMigrations } from '../src/db.js'
import { ensureWorkspaceScaffold, loadPrimeWorkspaceTemplates } from '../src/workspace.js'

const TEST_DB = process.env.TEST_DATABASE_URL!
process.env.SECRET_ENCRYPTION_KEY = 'a'.repeat(64)

describe('workspace prime-soul template', () => {
  let pool: pg.Pool

  beforeAll(async () => {
    pool = createPool(TEST_DB)
    await runMigrations(pool)
    await ensureWorkspaceScaffold(pool)
  })

  afterAll(async () => {
    await pool.end()
  })

  it('scaffolds prime-soul.md from the shipped default', async () => {
    const bundle = await loadPrimeWorkspaceTemplates(pool)
    expect(bundle.templates.primeSoul).toBeDefined()
    expect(bundle.templates.primeSoul.length).toBeGreaterThan(100)
    expect(bundle.templates.primeSoul).toContain('## Identity')
    expect(bundle.templatePaths.primeSoul).toBe('agents/prime-soul.md')
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd backend && npx vitest run tests/workspace.test.ts -t "prime-soul"`
Expected: FAIL — `primeSoul` is `undefined` on the bundle.

- [ ] **Step 4: Add `primeSoul` to `TEMPLATE_PATHS` and the loader**

In `backend/src/workspace.ts`, update the `TEMPLATE_PATHS` constant (around line 55):

```ts
const TEMPLATE_PATHS = {
  primeProfile: 'agents/prime.md',
  primeSoul: 'agents/prime-soul.md',
  standingRules: 'policies/standing-rules.md',
  system: 'prompts/prime/system.md',
  request: 'prompts/prime/request.md',
  llamacpp: 'prompts/prime/llamacpp.md',
  defaultAgentInstructions: 'prompts/agents/default-instructions.md',
  defaultAgentSoul: 'prompts/agents/default-soul.md',
  delegationTask: 'prompts/delegation/task.md',
} as const
```

Update `loadPrimeWorkspaceTemplates` (around line 231) to read and return the new template:

```ts
export async function loadPrimeWorkspaceTemplates(pool: pg.Pool): Promise<WorkspaceTemplateBundle> {
  const status = await ensureWorkspaceScaffold(pool)
  const [
    primeProfile, primeSoul, standingRules, system, request, llamacpp,
    defaultAgentInstructions, defaultAgentSoul, delegationTask,
  ] = await Promise.all([
    readWorkspaceOrFallback(status.effective_root, TEMPLATE_PATHS.primeProfile, 'agents/prime.md'),
    readWorkspaceOrFallback(status.effective_root, TEMPLATE_PATHS.primeSoul, 'agents/prime-soul.md'),
    readWorkspaceOrFallback(status.effective_root, TEMPLATE_PATHS.standingRules, 'policies/standing-rules.md'),
    readWorkspaceOrFallback(status.effective_root, TEMPLATE_PATHS.system, 'prime/system.md'),
    readWorkspaceOrFallback(status.effective_root, TEMPLATE_PATHS.request, 'prime/request.md'),
    readWorkspaceOrFallback(status.effective_root, TEMPLATE_PATHS.llamacpp, 'prime/llamacpp.md'),
    readWorkspaceOrFallback(status.effective_root, TEMPLATE_PATHS.defaultAgentInstructions, 'agents/default-instructions.md'),
    readWorkspaceOrFallback(status.effective_root, TEMPLATE_PATHS.defaultAgentSoul, 'agents/default-soul.md'),
    readWorkspaceOrFallback(status.effective_root, TEMPLATE_PATHS.delegationTask, 'delegation/task.md'),
  ])
  const gitMeta = await readGitMetadata(status.effective_root)
  return {
    effectiveRoot: status.effective_root,
    revision: gitMeta.lastCommit,
    templates: {
      primeProfile,
      primeSoul,
      standingRules,
      system,
      request,
      llamacpp,
      defaultAgentInstructions,
      defaultAgentSoul,
      delegationTask,
    },
    templatePaths: { ...TEMPLATE_PATHS },
  }
}
```

Add a case to `keyToFallbackPath` (around line 320):

```ts
function keyToFallbackPath(key: keyof typeof TEMPLATE_PATHS): string {
  switch (key) {
    case 'primeProfile':
      return 'agents/prime.md'
    case 'primeSoul':
      return 'agents/prime-soul.md'
    case 'standingRules':
      return 'policies/standing-rules.md'
    case 'system':
      return 'prime/system.md'
    case 'request':
      return 'prime/request.md'
    case 'llamacpp':
      return 'prime/llamacpp.md'
    case 'defaultAgentInstructions':
      return 'agents/default-instructions.md'
    case 'defaultAgentSoul':
      return 'agents/default-soul.md'
    case 'delegationTask':
      return 'delegation/task.md'
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd backend && npx vitest run tests/workspace.test.ts -t "prime-soul"`
Expected: PASS.

- [ ] **Step 6: Run the full backend test suite to confirm nothing regressed**

Run: `cd backend && npx vitest run`
Expected: PASS — including all previously-passing tests.

- [ ] **Step 7: Commit**

```bash
git add backend/src/workspace.ts backend/tests/workspace.test.ts
git commit -m "feat(prime): load prime-soul.md alongside prime.md in workspace templates"
```

---

## Task 4: System prompt template includes the soul block

**Files:**
- Modify: `backend/prompts/prime/system.md`
- Modify: `backend/src/prime-agent/llm-router.ts:211-250` (`buildPrimeSystemPrompt`)
- Modify: `backend/tests/prime-agent/llm-router.test.ts` (find existing tests for `buildPrimeSystemPrompt`)

Today the system prompt template starts with `{{prime_profile}}`. After this task it starts with `{{prime_soul}}` followed by `{{prime_profile}}`.

- [ ] **Step 1: Find existing system-prompt-related tests**

Run: `cd backend && grep -n "buildPrimeSystemPrompt\|prime_profile\|prime_soul" tests/prime-agent/`

Note any test file that asserts on the contents of the system prompt — you will extend it in the next step.

- [ ] **Step 2: Add a failing test**

In whichever test file exercises `buildPrimeSystemPrompt` (likely `tests/prime-agent/llm-router.test.ts`), add:

```ts
it('system prompt includes both soul and operating profile blocks', async () => {
  // Arrange: ensure workspace defaults are populated; use the existing
  // test setup pattern from the surrounding `describe` block.
  const prompt = await buildPrimeSystemPrompt(testContext, pool)
  expect(prompt).toContain('## Identity')
  expect(prompt).toContain('## Default Behaviors')
  expect(prompt.indexOf('## Identity'))
    .toBeLessThan(prompt.indexOf('## Default Behaviors'))
})
```

If `buildPrimeSystemPrompt` is not currently imported there, import it from `../../src/prime-agent/llm-router.js`.

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd backend && npx vitest run tests/prime-agent/llm-router.test.ts -t "soul"`
Expected: FAIL — `## Identity` not found in the prompt (the template only references `{{prime_profile}}`).

- [ ] **Step 4: Update the system prompt template**

Modify `backend/prompts/prime/system.md` so the top reads:

```
{{prime_soul}}

{{prime_profile}}

## Standing Rules

{{standing_rules}}
```

(Keep everything after `## Standing Rules` exactly as it was.)

- [ ] **Step 5: Update `buildPrimeSystemPrompt` to pass both variables**

In `backend/src/prime-agent/llm-router.ts` around line 227, change the `renderTemplate` call's substitutions object to include `prime_soul`:

```ts
return renderTemplate(templates.templates.system, {
  prime_soul: templates.templates.primeSoul.trim(),
  prime_profile: templates.templates.primeProfile.trim() || profile?.persona || 'You are Prime.',
  standing_rules: templates.templates.standingRules.trim() || profile?.operating_policy || '',
  // ... keep all other existing substitutions unchanged
})
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd backend && npx vitest run tests/prime-agent/llm-router.test.ts -t "soul"`
Expected: PASS.

- [ ] **Step 7: Run the full prime-agent test suite**

Run: `cd backend && npx vitest run tests/prime-agent/`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/prompts/prime/system.md backend/src/prime-agent/llm-router.ts backend/tests/prime-agent/llm-router.test.ts
git commit -m "feat(prime): inject prime-soul block into system prompt"
```

---

## Task 5: Profile API endpoints (GET / PUT / PATCH)

**Files:**
- Create: `backend/src/routes/prime-profile.ts`
- Modify: `backend/src/app.ts` (wire up the new router — exact line will be obvious from existing route registrations)
- Modify: `backend/src/workspace.ts` (add helper that reads + writes profile files together)
- Create: `backend/tests/routes/prime-profile.route.test.ts`

This task is the largest. Build the helper first, then the routes via TDD.

- [ ] **Step 1: Write a failing test for the new write helper**

Append to `backend/tests/workspace.test.ts`:

```ts
import { writeProfileFiles, readProfileFiles } from '../src/workspace.js'

describe('readProfileFiles / writeProfileFiles', () => {
  let pool: pg.Pool

  beforeAll(async () => {
    pool = createPool(TEST_DB)
    await runMigrations(pool)
    await ensureWorkspaceScaffold(pool)
  })

  afterAll(async () => {
    await pool.end()
  })

  it('reads parsed sections from both workspace files', async () => {
    const profile = await readProfileFiles(pool)
    expect(profile.soul.sections.identity).toBeTruthy()
    expect(profile.operating.sections.default_behaviors).toBeTruthy()
  })

  it('writes both files and updates chief_profiles.persona', async () => {
    await writeProfileFiles(pool, {
      soul:      { sections: { identity: 'I am Prime.', voice_tone: 'Direct.', decision_style: 'Small steps.' }, unknown: [] },
      operating: { sections: { default_behaviors: 'Delegate.', approval_thresholds: 'Escalate destructive.' }, unknown: [] },
    })
    const reread = await readProfileFiles(pool)
    expect(reread.soul.sections.identity).toBe('I am Prime.')
    expect(reread.operating.sections.default_behaviors).toBe('Delegate.')

    const { rows } = await pool.query("SELECT persona FROM chief_profiles WHERE id = 'default'")
    expect(rows[0].persona).toContain('## Identity')
    expect(rows[0].persona).toContain('## Default Behaviors')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx vitest run tests/workspace.test.ts -t "readProfileFiles"`
Expected: FAIL — `readProfileFiles` / `writeProfileFiles` not exported.

- [ ] **Step 3: Implement the helpers**

Append to `backend/src/workspace.ts`:

```ts
import {
  parseProfileSections,
  renderProfileSections,
  type ParsedProfile,
} from './prime-agent/profile-sections.js'

export interface ProfileBundle {
  soul: ParsedProfile
  operating: ParsedProfile
}

export async function readProfileFiles(pool: pg.Pool): Promise<ProfileBundle> {
  const bundle = await loadPrimeWorkspaceTemplates(pool)
  return {
    soul:      parseProfileSections(bundle.templates.primeSoul,    'soul'),
    operating: parseProfileSections(bundle.templates.primeProfile, 'operating'),
  }
}

export async function writeProfileFiles(pool: pg.Pool, bundle: ProfileBundle): Promise<void> {
  const status = await ensureWorkspaceScaffold(pool)
  const soulMd      = renderProfileSections('soul',      bundle.soul)
  const operatingMd = renderProfileSections('operating', bundle.operating)

  await fs.mkdir(path.join(status.effective_root, 'agents'), { recursive: true })
  await fs.writeFile(path.join(status.effective_root, 'agents', 'prime-soul.md'), soulMd, 'utf8')
  await fs.writeFile(path.join(status.effective_root, 'agents', 'prime.md'),      operatingMd, 'utf8')

  const personaConcat = [soulMd.trim(), operatingMd.trim()].filter(Boolean).join('\n\n')
  await pool.query(
    `UPDATE chief_profiles SET persona = $1, updated_at = now() WHERE id = 'default'`,
    [personaConcat],
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npx vitest run tests/workspace.test.ts -t "readProfileFiles"`
Expected: PASS.

- [ ] **Step 5: Write failing tests for the route**

Create `backend/tests/routes/prime-profile.route.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import pg from 'pg'
import { createPool, runMigrations } from '../../src/db.js'
import { createPrimeProfileRouter } from '../../src/routes/prime-profile.js'
import { ensureWorkspaceScaffold, writeProfileFiles } from '../../src/workspace.js'

const TEST_DB = process.env.TEST_DATABASE_URL!
process.env.SECRET_ENCRYPTION_KEY = 'a'.repeat(64)

describe('GET /api/prime-agent/profile', () => {
  let pool: pg.Pool
  let app: express.Application

  beforeAll(async () => {
    pool = createPool(TEST_DB)
    await runMigrations(pool)
    await ensureWorkspaceScaffold(pool)
    app = express()
    app.use(express.json())
    app.use('/api/prime-agent/profile', createPrimeProfileRouter({ pool }))
  })

  afterAll(async () => {
    await pool.end()
  })

  it('returns parsed sections and defaults_match flags', async () => {
    const res = await request(app).get('/api/prime-agent/profile')
    expect(res.status).toBe(200)
    expect(res.body.name).toBeDefined()
    expect(res.body.soul.identity).toContain('coordination layer')
    expect(res.body.operating.default_behaviors).toContain('delegation')
    expect(res.body.defaults_match.identity).toBe(true)
    expect(res.body.defaults_match.default_behaviors).toBe(true)
    expect(res.body.shipped_defaults.identity).toContain('coordination layer')
    expect(res.body.shipped_defaults.default_behaviors).toContain('delegation')
  })

  it('reports defaults_match=false after a section diverges', async () => {
    await writeProfileFiles(pool, {
      soul:      { sections: { identity: 'CUSTOM identity', voice_tone: 'x', decision_style: 'y' }, unknown: [] },
      operating: { sections: { default_behaviors: 'CUSTOM behaviors', approval_thresholds: 'z' }, unknown: [] },
    })
    const res = await request(app).get('/api/prime-agent/profile')
    expect(res.body.defaults_match.identity).toBe(false)
    expect(res.body.defaults_match.default_behaviors).toBe(false)
  })
})

describe('PUT /api/prime-agent/profile', () => {
  let pool: pg.Pool
  let app: express.Application

  beforeAll(async () => {
    pool = createPool(TEST_DB)
    await runMigrations(pool)
    await ensureWorkspaceScaffold(pool)
    app = express()
    app.use(express.json())
    app.use('/api/prime-agent/profile', createPrimeProfileRouter({ pool }))
  })

  afterAll(async () => {
    await pool.end()
  })

  it('writes all sections and updates persona', async () => {
    const res = await request(app)
      .put('/api/prime-agent/profile')
      .send({
        name: 'Prime',
        soul:      { identity: 'a', voice_tone: 'b', decision_style: 'c' },
        operating: { default_behaviors: 'd', approval_thresholds: 'e' },
      })
    expect(res.status).toBe(200)
    expect(res.body.soul.identity).toBe('a')
    expect(res.body.operating.approval_thresholds).toBe('e')
  })
})

describe('PATCH /api/prime-agent/profile/sections/:key', () => {
  let pool: pg.Pool
  let app: express.Application

  beforeAll(async () => {
    pool = createPool(TEST_DB)
    await runMigrations(pool)
    await ensureWorkspaceScaffold(pool)
    app = express()
    app.use(express.json())
    app.use('/api/prime-agent/profile', createPrimeProfileRouter({ pool }))
  })

  afterAll(async () => {
    await pool.end()
  })

  it('updates one section and leaves the others untouched', async () => {
    await request(app).put('/api/prime-agent/profile').send({
      name: 'Prime',
      soul:      { identity: 'original', voice_tone: 'vt', decision_style: 'ds' },
      operating: { default_behaviors: 'db', approval_thresholds: 'at' },
    })
    const res = await request(app)
      .patch('/api/prime-agent/profile/sections/identity')
      .send({ new_text: 'updated' })
    expect(res.status).toBe(200)
    expect(res.body.soul.identity).toBe('updated')
    expect(res.body.soul.voice_tone).toBe('vt')
    expect(res.body.operating.default_behaviors).toBe('db')
  })

  it('rejects unknown section keys', async () => {
    const res = await request(app)
      .patch('/api/prime-agent/profile/sections/bogus')
      .send({ new_text: 'x' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/unknown section/i)
  })
})

describe('GET /api/prime-agent/profile — legacy migration', () => {
  let pool: pg.Pool
  let app: express.Application

  beforeAll(async () => {
    pool = createPool(TEST_DB)
    await runMigrations(pool)
    const status = await ensureWorkspaceScaffold(pool)

    // Simulate legacy state: delete prime-soul.md to mimic an existing
    // install that pre-dates this feature.
    const { promises: fs } = await import('node:fs')
    const path = (await import('node:path')).default
    await fs.rm(path.join(status.effective_root, 'agents/prime-soul.md'), { force: true })

    app = express()
    app.use(express.json())
    app.use('/api/prime-agent/profile', createPrimeProfileRouter({ pool }))
  })

  afterAll(async () => {
    await pool.end()
  })

  it('materializes prime-soul.md from the shipped default', async () => {
    const res = await request(app).get('/api/prime-agent/profile')
    expect(res.status).toBe(200)
    expect(res.body.soul.identity).toContain('coordination layer')
  })
})
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `cd backend && npx vitest run tests/routes/prime-profile.route.test.ts`
Expected: FAIL — `createPrimeProfileRouter` not exported.

- [ ] **Step 7: Implement the router**

Create `backend/src/routes/prime-profile.ts`:

```ts
import { Router } from 'express'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type pg from 'pg'
import {
  parseProfileSections,
  renderProfileSections,
  SECTION_DEFS,
  SOUL_SECTION_KEYS,
  OPERATING_SECTION_KEYS,
  type SectionKey,
  type ProfileFile,
} from '../prime-agent/profile-sections.js'
import {
  ensureWorkspaceScaffold,
  readProfileFiles,
  writeProfileFiles,
  type ProfileBundle,
} from '../workspace.js'

const FALLBACK_PROMPTS_DIR = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '../../prompts/agents',
)

async function loadShippedDefault(file: ProfileFile): Promise<string> {
  const name = file === 'soul' ? 'prime-soul.md' : 'prime.md'
  return fs.readFile(path.join(FALLBACK_PROMPTS_DIR, name), 'utf8')
}

async function shippedDefaultSections(file: ProfileFile): Promise<Record<string, string>> {
  const md = await loadShippedDefault(file)
  const parsed = parseProfileSections(md, file)
  return parsed.sections as Record<string, string>
}

async function materializeLegacySoulIfMissing(pool: pg.Pool): Promise<void> {
  const status = await ensureWorkspaceScaffold(pool)
  const soulPath = path.join(status.effective_root, 'agents', 'prime-soul.md')
  try {
    await fs.access(soulPath)
  } catch {
    const def = await loadShippedDefault('soul')
    await fs.mkdir(path.dirname(soulPath), { recursive: true })
    await fs.writeFile(soulPath, def, 'utf8')
  }
}

function flattenSections(bundle: ProfileBundle): Record<SectionKey, string> {
  const out: Partial<Record<SectionKey, string>> = {}
  for (const key of SOUL_SECTION_KEYS) out[key] = bundle.soul.sections[key] ?? ''
  for (const key of OPERATING_SECTION_KEYS) out[key] = bundle.operating.sections[key] ?? ''
  return out as Record<SectionKey, string>
}

async function getProfileName(pool: pg.Pool): Promise<string> {
  const { rows } = await pool.query("SELECT name FROM chief_profiles WHERE id = 'default'")
  return rows[0]?.name?.trim() || 'Prime'
}

async function shapedProfileResponse(pool: pg.Pool): Promise<Record<string, unknown>> {
  await materializeLegacySoulIfMissing(pool)
  const bundle = await readProfileFiles(pool)
  const flat = flattenSections(bundle)

  const defaults_match: Partial<Record<SectionKey, boolean>> = {}
  const soulDefaults      = await shippedDefaultSections('soul')
  const operatingDefaults = await shippedDefaultSections('operating')
  const merged: Record<string, string> = { ...soulDefaults, ...operatingDefaults }
  for (const key of [...SOUL_SECTION_KEYS, ...OPERATING_SECTION_KEYS]) {
    defaults_match[key as SectionKey] = (flat[key as SectionKey] ?? '').trim() === (merged[key] ?? '').trim()
  }

  return {
    name: await getProfileName(pool),
    soul: {
      identity:       flat.identity ?? '',
      voice_tone:     flat.voice_tone ?? '',
      decision_style: flat.decision_style ?? '',
    },
    operating: {
      default_behaviors:   flat.default_behaviors ?? '',
      approval_thresholds: flat.approval_thresholds ?? '',
    },
    defaults_match,
    shipped_defaults: {
      identity:            merged.identity            ?? '',
      voice_tone:          merged.voice_tone          ?? '',
      decision_style:      merged.decision_style      ?? '',
      default_behaviors:   merged.default_behaviors   ?? '',
      approval_thresholds: merged.approval_thresholds ?? '',
    },
  }
}

function isSectionKey(value: unknown): value is SectionKey {
  return typeof value === 'string' && value in SECTION_DEFS
}

export function createPrimeProfileRouter({ pool }: { pool: pg.Pool }) {
  const router = Router()

  router.get('/', async (_req, res) => {
    try {
      res.json(await shapedProfileResponse(pool))
    } catch (err) {
      res.status(500).json({ error: (err as Error).message ?? 'internal error' })
    }
  })

  router.put('/', async (req, res) => {
    const body = req.body as {
      name?: string
      soul?: { identity?: string; voice_tone?: string; decision_style?: string }
      operating?: { default_behaviors?: string; approval_thresholds?: string }
    }
    try {
      await materializeLegacySoulIfMissing(pool)
      const current = await readProfileFiles(pool)
      if (body.soul) {
        current.soul.sections = {
          identity:       body.soul.identity       ?? current.soul.sections.identity       ?? '',
          voice_tone:     body.soul.voice_tone     ?? current.soul.sections.voice_tone     ?? '',
          decision_style: body.soul.decision_style ?? current.soul.sections.decision_style ?? '',
        }
      }
      if (body.operating) {
        current.operating.sections = {
          default_behaviors:   body.operating.default_behaviors   ?? current.operating.sections.default_behaviors   ?? '',
          approval_thresholds: body.operating.approval_thresholds ?? current.operating.sections.approval_thresholds ?? '',
        }
      }
      await writeProfileFiles(pool, current)
      if (typeof body.name === 'string' && body.name.trim()) {
        await pool.query(
          `UPDATE chief_profiles SET name = $1, updated_at = now() WHERE id = 'default'`,
          [body.name.trim()],
        )
      }
      res.json(await shapedProfileResponse(pool))
    } catch (err) {
      res.status(500).json({ error: (err as Error).message ?? 'internal error' })
    }
  })

  router.patch('/sections/:key', async (req, res) => {
    const key = req.params.key
    if (!isSectionKey(key)) {
      return res.status(400).json({ error: `unknown section key: ${key}` })
    }
    const newText = (req.body as { new_text?: string })?.new_text
    if (typeof newText !== 'string') {
      return res.status(400).json({ error: 'new_text required' })
    }
    try {
      await materializeLegacySoulIfMissing(pool)
      const current = await readProfileFiles(pool)
      const file = SECTION_DEFS[key].file
      current[file].sections[key] = newText
      await writeProfileFiles(pool, current)
      res.json(await shapedProfileResponse(pool))
    } catch (err) {
      res.status(500).json({ error: (err as Error).message ?? 'internal error' })
    }
  })

  return router
}
```

- [ ] **Step 8: Wire the router into `app.ts`**

Find where `createPrimeAgentRouter` is mounted in `backend/src/app.ts` (use `grep -n createPrimeAgentRouter backend/src/app.ts`). Mount the new router on a related path. Above or below that line, add:

```ts
import { createPrimeProfileRouter } from './routes/prime-profile.js'
// ...
app.use('/api/prime-agent/profile', createPrimeProfileRouter({ pool }))
```

- [ ] **Step 9: Run the route tests**

Run: `cd backend && npx vitest run tests/routes/prime-profile.route.test.ts`
Expected: PASS.

- [ ] **Step 10: Run the full backend suite**

Run: `cd backend && npx vitest run`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add backend/src/routes/prime-profile.ts backend/src/workspace.ts backend/src/app.ts backend/tests/routes/prime-profile.route.test.ts backend/tests/workspace.test.ts
git commit -m "feat(prime): add /api/prime-agent/profile GET/PUT/PATCH endpoints"
```

---

## Task 6: Setup endpoint accepts structured profile (legacy-compatible)

**Files:**
- Modify: `backend/src/routes/setup.ts:121-260` (request handler + `writeWorkspaceSetupFiles`)
- Modify: `backend/tests/setup.route.test.ts`

`POST /api/setup/complete` accepts the new `profile` object. If `profile` is absent, the legacy `persona` payload still works.

- [ ] **Step 1: Write failing tests**

Append to `backend/tests/setup.route.test.ts`:

```ts
describe('POST /api/setup/complete — structured profile', () => {
  let pool: pg.Pool
  let app: express.Application

  beforeAll(async () => {
    pool = createPool(TEST_DB)
    await runMigrations(pool)
    await pool.query('DELETE FROM providers')
    app = express()
    app.use(express.json())
    app.use('/api/setup', createSetupRouter({ pool }))
  })

  afterAll(async () => {
    await pool.end()
  })

  it('accepts a structured profile payload and writes both files', async () => {
    const res = await request(app)
      .post('/api/setup/complete')
      .send({
        providers: [{ name: 'p', type: 'anthropic', base_url: 'https://x', api_key: 'k', model: 'm' }],
        routing: {},
        profile: {
          name: 'Prime',
          soul:      { identity: 'I am Prime.', voice_tone: 'Direct.', decision_style: 'Small steps.' },
          operating: { default_behaviors: 'Delegate.', approval_thresholds: 'Escalate destructive.' },
        },
        rules: { presets: [], custom: '' },
        workspace: { mode: 'local', root_path: '../.agent-workspace', branch: 'main' },
      })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })

    const { rows } = await pool.query("SELECT persona FROM chief_profiles WHERE id = 'default'")
    expect(rows[0].persona).toContain('## Identity')
    expect(rows[0].persona).toContain('## Default Behaviors')
  })

  it('maps legacy persona payload onto structured sections', async () => {
    const res = await request(app)
      .post('/api/setup/complete')
      .send({
        providers: [{ name: 'p2', type: 'anthropic', base_url: 'https://x', api_key: 'k', model: 'm' }],
        routing: {},
        persona: { name: 'Prime', focus: 'engineering coordinator', tone: 'direct', instructions: 'be fast' },
        rules: { presets: [], custom: '' },
        workspace: { mode: 'local', root_path: '../.agent-workspace', branch: 'main' },
      })
    expect(res.status).toBe(200)

    const { rows } = await pool.query("SELECT persona FROM chief_profiles WHERE id = 'default'")
    expect(rows[0].persona).toContain('engineering coordinator')
    expect(rows[0].persona).toContain('be fast')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx vitest run tests/setup.route.test.ts -t "structured profile"`
Expected: FAIL — endpoint either rejects the new payload or writes the wrong files.

- [ ] **Step 3: Rewrite the setup completion handler**

In `backend/src/routes/setup.ts`, replace the body of `router.post('/complete', ...)` (starting around line 121) and the `writeWorkspaceSetupFiles` helper (starting around line 271). The new handler shape:

```ts
import {
  SOUL_SECTION_KEYS,
  OPERATING_SECTION_KEYS,
  type SectionKey,
  type SoulSectionKey,
  type OperatingSectionKey,
} from '../prime-agent/profile-sections.js'
import { writeProfileFiles, readProfileFiles, ensureWorkspaceScaffold } from '../workspace.js'

// Replace the existing PRESET_LABELS, persona parsing, and writeWorkspaceSetupFiles
// usage with this structured profile path. Keep the providers + routing + workspace
// + onboarding-thread sections of the original handler intact.

router.post('/complete', async (req, res) => {
  const body = req.body as {
    providers?: Array<{ id?: string; name: string; type: string; base_url: string; api_key?: string; model?: string }>
    routing?: Record<string, Array<{ provider_name: string; model: string }>>
    profile?: {
      name?: string
      soul?: { identity?: string; voice_tone?: string; decision_style?: string }
      operating?: { default_behaviors?: string; approval_thresholds?: string }
    }
    persona?: { name: string; focus: string; tone: string; instructions?: string }
    rules?: { presets: string[]; custom: string }
    cost_controls?: { monthly_token_budget: number }
    workspace?: { mode?: 'local' | 'git'; root_path?: string; remote_url?: string; branch?: string }
    launch?: boolean
  }

  if (!Array.isArray(body?.providers) || !body?.routing || !body?.rules || (!body.profile && !body.persona)) {
    return res.status(400).json({ error: 'providers, routing, rules, and (profile or persona) are required' })
  }

  try {
    // --- providers + routing block: KEEP EXISTING LOGIC EXACTLY AS IT IS ---
    const providerNameToId = new Map<string, string>()
    // ... existing block from setup.ts:136-172 unchanged ...
    const routing: Record<string, Array<{ provider_id: string; model: string }>> = {}
    // ... existing block from setup.ts:174-180 unchanged ...

    // --- profile block (new) ---
    const name = body.profile?.name?.trim() || body.persona?.name?.trim() || 'Prime'

    let soulSections: Record<SoulSectionKey, string>
    let operatingSections: Record<OperatingSectionKey, string>

    if (body.profile) {
      soulSections = {
        identity:       body.profile.soul?.identity       ?? '',
        voice_tone:     body.profile.soul?.voice_tone     ?? '',
        decision_style: body.profile.soul?.decision_style ?? '',
      }
      operatingSections = {
        default_behaviors:   body.profile.operating?.default_behaviors   ?? '',
        approval_thresholds: body.profile.operating?.approval_thresholds ?? '',
      }
    } else {
      const p = body.persona!
      const toneLabel =
        p.tone === 'direct' ? 'Direct & concise.'
        : p.tone === 'thorough' ? 'Thorough & deliberate.'
        : 'Collaborative & inquisitive.'
      soulSections = {
        identity:       `You are ${name}, ${p.focus || 'the coordination agent'}.`,
        voice_tone:     toneLabel,
        decision_style: (p.instructions ?? '').trim() || 'Smallest useful next step wins.',
      }
      // For legacy callers we leave the operating sections empty — defaults from
      // the shipped template will fill the gap on read.
      operatingSections = { default_behaviors: '', approval_thresholds: '' }
    }

    await ensureWorkspaceScaffold(pool)

    // Seed chief_profiles row if missing; the column will be overwritten by
    // writeProfileFiles immediately after.
    await pool.query(
      `INSERT INTO chief_profiles (id, name, persona, operating_policy)
       VALUES ('default', $1, '', '')
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, updated_at = now()`,
      [name],
    )

    // Read existing (so unknown sections are preserved across legacy → structured upgrade)
    const current = await readProfileFiles(pool)
    current.soul.sections = soulSections
    if (body.profile) {
      current.operating.sections = operatingSections
    }
    await writeProfileFiles(pool, current)

    // --- standing rules + cost controls + workspace + launch: KEEP EXISTING LOGIC ---
    // (operating_policy, prime_agent_config, onboarding thread creation, etc.
    //  remain identical to today's handler.)

    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message ?? 'internal error' })
  }
})
```

Important: **only the profile block is new.** The providers, routing, standing-rules, workspace, and onboarding-thread blocks remain exactly as they are today in `setup.ts`. Do not delete them.

Delete the old `writeWorkspaceSetupFiles` function (around line 271-300) — it is now dead code since `writeProfileFiles` does the same job through the parser. Delete the call site that invoked it (around line 219). Check whether `import { promises as fs } from 'node:fs'` and `import path from 'node:path'` are still referenced elsewhere in `setup.ts` (use `grep -n "fs\.\|path\." backend/src/routes/setup.ts`); remove them only if no remaining references exist.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx vitest run tests/setup.route.test.ts`
Expected: PASS — including the new tests AND all pre-existing setup tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/setup.ts backend/tests/setup.route.test.ts
git commit -m "feat(setup): accept structured profile payload alongside legacy persona"
```

---

## Task 7: `update_profile` action handler

**Files:**
- Modify: `backend/src/prime-agent/llm-router.ts:9-14` (`PRIME_ACTION_TYPES`)
- Modify: `backend/src/prime-agent/llm-router.ts:374-396` (llama.cpp JSON schema) and `:521-540` (OpenAI structured-output schema)
- Modify: `backend/src/prime-agent/actions.ts:36-54` (`dispatchPrimeActions` switch)
- Modify: `backend/src/prime-agent/actions.ts` (add new dispatch function)
- Modify: `backend/tests/prime-agent/actions.test.ts`

Add `update_profile` as a first-class action with diff-then-apply semantics.

- [ ] **Step 1: Write failing tests**

Append to `backend/tests/prime-agent/actions.test.ts` (the existing file already mocks `runtime.js`; extend its mocks first):

In the `runtimeMocks` block at the top, add:

```ts
const runtimeMocks = vi.hoisted(() => ({
  createWorkItem: vi.fn(),
  createDelegation: vi.fn(),
  updateWorkItem: vi.fn(),
  insertRuntimeEvent: vi.fn(),
  getPrimeProfile: vi.fn(),
  appendThreadMessage: vi.fn(),
}))
```

And in the corresponding `vi.mock('../../src/runtime.js', ...)` call, add `appendThreadMessage: runtimeMocks.appendThreadMessage,`.

Add a `workspaceMocks` block:

```ts
const workspaceMocks = vi.hoisted(() => ({
  readProfileFiles:  vi.fn(),
  writeProfileFiles: vi.fn(),
}))

vi.mock('../../src/workspace.js', () => ({
  readProfileFiles:  workspaceMocks.readProfileFiles,
  writeProfileFiles: workspaceMocks.writeProfileFiles,
}))
```

Then add tests at the bottom:

```ts
describe('dispatchPrimeActions — update_profile', () => {
  beforeEach(() => {
    runtimeMocks.appendThreadMessage.mockReset()
    runtimeMocks.insertRuntimeEvent.mockReset()
    runtimeMocks.getPrimeProfile.mockResolvedValue({ name: 'Prime' })
    workspaceMocks.readProfileFiles.mockReset()
    workspaceMocks.writeProfileFiles.mockReset()
    workspaceMocks.readProfileFiles.mockResolvedValue({
      soul:      { sections: { identity: 'old', voice_tone: '', decision_style: '' }, unknown: [] },
      operating: { sections: { default_behaviors: '', approval_thresholds: '' },     unknown: [] },
    })
    workspaceMocks.writeProfileFiles.mockResolvedValue(undefined)
  })

  it('updates a soul section and writes back', async () => {
    await dispatchPrimeActions(pool, context, {
      reasoning: 'tweak identity',
      response: 'updated identity',
      actions: [{
        type: 'update_profile',
        payload: { file: 'soul', section_key: 'identity', new_text: 'new identity text', reason: 'user asked' },
        reason: 'user asked',
      }],
    })

    expect(workspaceMocks.writeProfileFiles).toHaveBeenCalled()
    const writtenBundle = workspaceMocks.writeProfileFiles.mock.calls[0][1]
    expect(writtenBundle.soul.sections.identity).toBe('new identity text')
  })

  it('appends a chat message containing the diff', async () => {
    await dispatchPrimeActions(pool, context, {
      reasoning: 'r',
      response: 'r',
      actions: [{
        type: 'update_profile',
        payload: { file: 'soul', section_key: 'identity', new_text: 'new', reason: 'user asked' },
        reason: 'user asked',
      }],
    })
    expect(runtimeMocks.appendThreadMessage).toHaveBeenCalled()
    const [, , msg] = runtimeMocks.appendThreadMessage.mock.calls[0]
    expect(msg.content).toContain('-old')
    expect(msg.content).toContain('+new')
  })

  it('emits prime.action.update_profile event', async () => {
    await dispatchPrimeActions(pool, context, {
      reasoning: 'r',
      response: 'r',
      actions: [{
        type: 'update_profile',
        payload: { file: 'soul', section_key: 'identity', new_text: 'new', reason: 'user asked' },
        reason: 'user asked',
      }],
    })
    expect(runtimeMocks.insertRuntimeEvent).toHaveBeenCalledWith(
      pool,
      expect.objectContaining({ event_type: 'prime.action.update_profile' }),
    )
  })

  it('rejects unknown section keys', async () => {
    await expect(dispatchPrimeActions(pool, context, {
      reasoning: 'r',
      response: 'r',
      actions: [{
        type: 'update_profile',
        payload: { file: 'soul', section_key: 'bogus', new_text: 'x', reason: 'why' },
        reason: 'why',
      }],
    })).rejects.toThrow(/unknown section/i)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx vitest run tests/prime-agent/actions.test.ts -t "update_profile"`
Expected: FAIL — `'update_profile'` not in `PRIME_ACTION_TYPES`, so validation strips it before dispatch.

- [ ] **Step 3: Extend `PRIME_ACTION_TYPES` and the LLM schemas**

In `backend/src/prime-agent/llm-router.ts:9-14`:

```ts
export const PRIME_ACTION_TYPES = [
  'delegate',
  'update_work_item',
  'request_approval',
  'update_profile',
  'no_op',
] as const
```

In the llama.cpp `json_schema` block (around line 387), change the enum to:

```ts
type: { type: 'string', enum: ['delegate', 'update_work_item', 'request_approval', 'update_profile', 'no_op'] },
```

Do the same for the OpenAI structured-output schema (around line 521). Use `grep -n "'no_op'" backend/src/prime-agent/llm-router.ts` to find every site.

- [ ] **Step 4: Add the dispatcher**

Append to `backend/src/prime-agent/actions.ts`:

```ts
import {
  SECTION_DEFS,
  type SectionKey,
} from './profile-sections.js'
import { readProfileFiles, writeProfileFiles } from '../workspace.js'
import { appendThreadMessage } from '../runtime.js'

function unifiedDiff(oldText: string, newText: string, label: string): string {
  const oldLines = oldText.split('\n')
  const newLines = newText.split('\n')
  const lines: string[] = [`--- ${label} (current)`, `+++ ${label} (proposed)`]
  for (const line of oldLines) lines.push(`-${line}`)
  for (const line of newLines) lines.push(`+${line}`)
  return lines.join('\n')
}

async function dispatchUpdateProfile(
  pool: pg.Pool,
  ctx: PrimeContext,
  action: PrimeAction,
): Promise<PrimeActionDispatchResult> {
  const sectionKey = stringField(action.payload, 'section_key') as SectionKey | undefined
  const newText = typeof action.payload.new_text === 'string' ? action.payload.new_text : undefined
  if (!sectionKey || !(sectionKey in SECTION_DEFS)) {
    throw new Error(`update_profile: unknown section key ${String(sectionKey)}`)
  }
  if (typeof newText !== 'string') {
    throw new Error('update_profile: new_text required')
  }

  const file = SECTION_DEFS[sectionKey].file
  const heading = SECTION_DEFS[sectionKey].heading
  const current = await readProfileFiles(pool)
  const previous = current[file].sections[sectionKey] ?? ''
  current[file].sections[sectionKey] = newText
  await writeProfileFiles(pool, current)

  const coordinatorName = await getCoordinatorName(pool)
  const threadId = stringField(action.payload, 'thread_id') ?? threadIdFromContext(ctx)
  const diff = unifiedDiff(previous, newText, heading)
  if (threadId) {
    await appendThreadMessage(pool, threadId, {
      role: 'assistant',
      sender: coordinatorName,
      content: [
        `Updated **${heading}**. Reason: ${action.reason}`,
        '',
        '```diff',
        diff,
        '```',
      ].join('\n'),
      metadata: {
        kind: 'profile-update',
        section_key: sectionKey,
        file,
      },
    })
  }

  await insertRuntimeEvent(pool, {
    event_type: 'prime.action.update_profile',
    actor: coordinatorName,
    thread_id: threadId,
    payload: {
      file,
      section_key: sectionKey,
      reason: action.reason,
    },
  })

  return { action, status: 'dispatched' }
}
```

Then add the case to the switch in `dispatchPrimeActions`:

```ts
case 'update_profile':
  results.push(await dispatchUpdateProfile(pool, ctx, action))
  break
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && npx vitest run tests/prime-agent/actions.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the full prime-agent suite**

Run: `cd backend && npx vitest run tests/prime-agent/`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/prime-agent/llm-router.ts backend/src/prime-agent/actions.ts backend/tests/prime-agent/actions.test.ts
git commit -m "feat(prime): add update_profile action with diff-then-apply"
```

---

## Task 8: System prompt documents the new action and onboarding tour

**Files:**
- Modify: `backend/prompts/prime/system.md`

This is a prompt-only change — no test required beyond the existing `prime-soul` test from Task 4.

- [ ] **Step 1: Update the system prompt**

Open `backend/prompts/prime/system.md`. Locate the "Response Format" section that documents action types. Update the JSON example to include `'update_profile'` in the type enum and add this block immediately after the existing `request_approval` payload documentation:

```markdown
For `update_profile`, payload must include:
- `file`: one of "soul" or "operating"
- `section_key`: one of "identity", "voice_tone", "decision_style", "default_behaviors", "approval_thresholds"
- `new_text`: the full new body for that section
- `reason`: explanation shown to the user in the diff

## Onboarding Threads

If the active thread has `metadata.kind == 'onboarding'`, the user may want to refine
your profile before starting real work. Offer a one-sentence summary of your active
profile and ask if they want to adjust anything. If they engage with profile content
("be more cautious", "change voice", "reset", "start over"), use `update_profile`
actions — one per section being edited — and explain the change conversationally in
`response`. If they hand you a real task instead, drop the tour and proceed normally.
```

- [ ] **Step 2: Verify the existing tests still pass**

Run: `cd backend && npx vitest run tests/prime-agent/llm-router.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add backend/prompts/prime/system.md
git commit -m "docs(prime): document update_profile action and onboarding tour in system prompt"
```

---

## Task 9: Onboarding greeting includes profile synopsis

**Files:**
- Modify: `backend/src/runtime.ts:181-201` (`ensureOnboardingThread`)
- Modify: `backend/src/routes/setup.ts:235-258` (the analogous greeting block in setup launch)
- Create: `backend/src/prime-agent/profile-synopsis.ts`
- Create: `backend/tests/prime-agent/profile-synopsis.test.ts`

A small helper produces the synopsis paragraph; both greeting paths call it.

- [ ] **Step 1: Write failing tests for the synopsis helper**

Create `backend/tests/prime-agent/profile-synopsis.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildProfileSynopsis } from '../../src/prime-agent/profile-synopsis.js'

describe('buildProfileSynopsis', () => {
  it('returns the shipped synopsis when every section is at default', () => {
    const synopsis = buildProfileSynopsis({ allDefault: true, divergingSectionTitles: [] })
    expect(synopsis).toContain('direct')
    expect(synopsis).toContain('escalate')
    expect(synopsis).toMatch(/adjust|tweak/i)
  })

  it('names diverging sections when the profile is customized', () => {
    const synopsis = buildProfileSynopsis({
      allDefault: false,
      divergingSectionTitles: ['Voice & Tone', 'Approval Thresholds'],
    })
    expect(synopsis).toContain('Voice & Tone')
    expect(synopsis).toContain('Approval Thresholds')
    expect(synopsis).toMatch(/adjust|tweak/i)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx vitest run tests/prime-agent/profile-synopsis.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

Create `backend/src/prime-agent/profile-synopsis.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npx vitest run tests/prime-agent/profile-synopsis.test.ts`
Expected: PASS.

- [ ] **Step 5: Add an integration test that the onboarding greeting uses the synopsis**

Append to `backend/tests/runtime.test.ts` (or `tests/runtime/` — find via `grep -rn ensureOnboardingThread tests/`). If no test file exists for this function, create `backend/tests/runtime.onboarding.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import pg from 'pg'
import { createPool, runMigrations } from '../src/db.js'
import { ensureOnboardingThread, listThreads, listThreadMessages } from '../src/runtime.js'

const TEST_DB = process.env.TEST_DATABASE_URL!
process.env.SECRET_ENCRYPTION_KEY = 'a'.repeat(64)

describe('ensureOnboardingThread', () => {
  let pool: pg.Pool

  beforeAll(async () => {
    pool = createPool(TEST_DB)
    await runMigrations(pool)
  })

  afterAll(async () => {
    await pool.end()
  })

  beforeEach(async () => {
    await pool.query('DELETE FROM thread_messages')
    await pool.query('DELETE FROM threads')
    await pool.query("UPDATE prime_agent_config SET enabled=true, setup_complete=true WHERE id='default'")
  })

  it('opens the onboarding thread with greeting + profile synopsis + tour offer', async () => {
    await ensureOnboardingThread(pool)
    const threads = await listThreads(pool)
    const onboarding = threads.find((t) => (t.metadata as { kind?: string }).kind === 'onboarding')
    expect(onboarding).toBeDefined()
    const messages = await listThreadMessages(pool, onboarding!.id)
    expect(messages).toHaveLength(1)
    expect(messages[0].content).toMatch(/adjust|tweak/i)
    expect(messages[0].content).toContain('direct') // from the shipped synopsis
  })
})
```

- [ ] **Step 6: Run that test to verify it fails**

Run: `cd backend && npx vitest run tests/runtime.onboarding.test.ts`
Expected: FAIL — greeting body does not contain "adjust" or "tweak" yet.

- [ ] **Step 7: Update `ensureOnboardingThread` and the setup-launch greeting**

In `backend/src/runtime.ts` around line 181, replace the body of `ensureOnboardingThread` (the existing greeting message construction):

```ts
import { readProfileFiles } from './workspace.js'
import { buildProfileSynopsis } from './prime-agent/profile-synopsis.js'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

async function computeSynopsisInput(pool: pg.Pool): Promise<{ allDefault: boolean; divergingSectionTitles: string[] }> {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const promptsDir = path.resolve(here, '../prompts/agents')
  const [soulDefault, operatingDefault] = await Promise.all([
    fs.readFile(path.join(promptsDir, 'prime-soul.md'), 'utf8'),
    fs.readFile(path.join(promptsDir, 'prime.md'),      'utf8'),
  ])
  const { parseProfileSections, SECTION_DEFS, SOUL_SECTION_KEYS, OPERATING_SECTION_KEYS } =
    await import('./prime-agent/profile-sections.js')

  const defaults = {
    soul:      parseProfileSections(soulDefault,      'soul').sections,
    operating: parseProfileSections(operatingDefault, 'operating').sections,
  }
  const actual = await readProfileFiles(pool)

  const diverging: string[] = []
  for (const key of SOUL_SECTION_KEYS) {
    if ((actual.soul.sections[key] ?? '').trim() !== (defaults.soul[key] ?? '').trim()) {
      diverging.push(SECTION_DEFS[key].heading)
    }
  }
  for (const key of OPERATING_SECTION_KEYS) {
    if ((actual.operating.sections[key] ?? '').trim() !== (defaults.operating[key] ?? '').trim()) {
      diverging.push(SECTION_DEFS[key].heading)
    }
  }

  return { allDefault: diverging.length === 0, divergingSectionTitles: diverging }
}
```

Then in `ensureOnboardingThread`, build the greeting body using the synopsis:

```ts
const primeName = primeRows[0]?.name?.trim() || 'Prime'
const synopsis = buildProfileSynopsis(await computeSynopsisInput(pool))
const onboardingThread = await createThread(pool, {
  title: `Getting started with ${primeName}`,
  metadata: { kind: 'onboarding', source: 'runtime-bootstrap' },
})
await appendThreadMessage(pool, onboardingThread.id, {
  role: 'assistant',
  sender: primeName,
  content: `I'm ${primeName}. ${synopsis}`,
  metadata: { kind: 'greeting' },
})
```

Apply the same change to the setup-launch greeting in `backend/src/routes/setup.ts` around line 241 (the `if (launch) { ... }` block). Concretely, after the `if (threadRows[0]?.count === 0)` guard, the body becomes:

```ts
const primeName = persona.name?.trim() || 'Prime'
const synopsis = buildProfileSynopsis(await computeSynopsisInput(pool))
const onboardingThread = await createThread(pool, {
  title: `Getting started with ${primeName}`,
  metadata: { kind: 'onboarding', source: 'setup-launch' },
})
await appendThreadMessage(pool, onboardingThread.id, {
  role: 'assistant',
  sender: primeName,
  content: `I'm ${primeName}. ${synopsis}`,
  metadata: { kind: 'greeting' },
})
```

Add the imports at the top of `setup.ts`: `import { buildProfileSynopsis } from '../prime-agent/profile-synopsis.js'` and the `computeSynopsisInput` import. To avoid duplicating `computeSynopsisInput` across `runtime.ts` and `setup.ts`, export it from `runtime.ts` and import it from there in `setup.ts`.

- [ ] **Step 8: Run the test to verify it passes**

Run: `cd backend && npx vitest run tests/runtime.onboarding.test.ts`
Expected: PASS.

- [ ] **Step 9: Run the full backend suite**

Run: `cd backend && npx vitest run`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add backend/src/prime-agent/profile-synopsis.ts backend/src/runtime.ts backend/src/routes/setup.ts backend/tests/prime-agent/profile-synopsis.test.ts backend/tests/runtime.onboarding.test.ts
git commit -m "feat(prime): onboarding greeting includes profile synopsis and tour offer"
```

---

## Task 10: Frontend types and API client

**Files:**
- Modify: `web/src/types.ts`
- Modify: `web/src/api.ts`

Pure type and fetch wiring — no UI yet.

- [ ] **Step 1: Add types**

Append to `web/src/types.ts`:

```ts
export interface PrimeProfileSoul {
  identity: string
  voice_tone: string
  decision_style: string
}

export interface PrimeProfileOperating {
  default_behaviors: string
  approval_thresholds: string
}

export type PrimeSectionKey =
  | 'identity' | 'voice_tone' | 'decision_style'
  | 'default_behaviors' | 'approval_thresholds'

export interface PrimeProfileResponse {
  name: string
  soul: PrimeProfileSoul
  operating: PrimeProfileOperating
  defaults_match: Record<PrimeSectionKey, boolean>
  shipped_defaults: Record<PrimeSectionKey, string>
}
```

- [ ] **Step 2: Add API functions**

Append to `web/src/api.ts`:

```ts
import type { PrimeProfileResponse, PrimeProfileSoul, PrimeProfileOperating, PrimeSectionKey } from './types'

export async function fetchPrimeProfile(): Promise<PrimeProfileResponse> {
  const res = await fetch(`${getApiOrigin()}/api/prime-agent/profile`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function savePrimeProfile(body: {
  name?: string
  soul?: Partial<PrimeProfileSoul>
  operating?: Partial<PrimeProfileOperating>
}): Promise<PrimeProfileResponse> {
  const res = await fetch(`${getApiOrigin()}/api/prime-agent/profile`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function patchPrimeProfileSection(
  key: PrimeSectionKey,
  newText: string,
): Promise<PrimeProfileResponse> {
  const res = await fetch(`${getApiOrigin()}/api/prime-agent/profile/sections/${key}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ new_text: newText }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}
```

- [ ] **Step 3: Verify the frontend still builds**

Run: `cd web && npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add web/src/types.ts web/src/api.ts
git commit -m "feat(web): add prime profile types and API client"
```

---

## Task 11: Wizard Personality step rewrite

**Files:**
- Modify: `web/src/pages/Setup.tsx` (the `StepPersonality` component around line 847; the `PersonaDraft` and `INITIAL_STATE`; `stepProgress(state, 3)`; `handleSubmit` payload around line 1212)
- Create: `web/tests/pages/Setup.personality.test.tsx`

The big UI change. Test first.

- [ ] **Step 1: Write failing tests**

Create `web/tests/pages/Setup.personality.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { StepPersonality, INITIAL_PROFILE_STATE, profileSubmitPayload } from '../../src/pages/Setup'
import type { ProfileDraft } from '../../src/pages/Setup'

const DEFAULTS: ProfileDraft = {
  name: 'Prime',
  view_mode: 'sections',
  soul: {
    identity: 'shipped identity',
    voice_tone: 'shipped voice',
    decision_style: 'shipped decision',
  },
  operating: {
    default_behaviors: 'shipped behaviors',
    approval_thresholds: 'shipped approval',
  },
  shipped_defaults: {
    identity: 'shipped identity',
    voice_tone: 'shipped voice',
    decision_style: 'shipped decision',
    default_behaviors: 'shipped behaviors',
    approval_thresholds: 'shipped approval',
  },
}

describe('StepPersonality — sections mode', () => {
  it('pre-fills every section with the shipped default', () => {
    render(<StepPersonality profile={DEFAULTS} onChange={vi.fn()} />)
    expect(screen.getByLabelText(/identity/i)).toHaveValue('shipped identity')
    expect(screen.getByLabelText(/voice & tone/i)).toHaveValue('shipped voice')
    expect(screen.getByLabelText(/default behaviors/i)).toHaveValue('shipped behaviors')
  })

  it('does not show Reset link when section matches the default', () => {
    render(<StepPersonality profile={DEFAULTS} onChange={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /reset identity/i })).toBeNull()
  })

  it('shows Reset link only on diverging sections', () => {
    const modified: ProfileDraft = {
      ...DEFAULTS,
      soul: { ...DEFAULTS.soul, identity: 'custom identity' },
    }
    render(<StepPersonality profile={modified} onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: /reset identity/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /reset voice/i })).toBeNull()
  })

  it('Clear all blanks every section', () => {
    const onChange = vi.fn()
    render(<StepPersonality profile={DEFAULTS} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: /clear all/i }))
    const arg = onChange.mock.calls[0][0] as ProfileDraft
    expect(arg.soul.identity).toBe('')
    expect(arg.operating.approval_thresholds).toBe('')
  })

  it('Reset all to defaults restores every section', () => {
    const onChange = vi.fn()
    const modified: ProfileDraft = {
      ...DEFAULTS,
      soul: { identity: 'X', voice_tone: 'Y', decision_style: 'Z' },
      operating: { default_behaviors: '', approval_thresholds: '' },
    }
    render(<StepPersonality profile={modified} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: /reset all/i }))
    const arg = onChange.mock.calls[0][0] as ProfileDraft
    expect(arg.soul.identity).toBe('shipped identity')
    expect(arg.operating.default_behaviors).toBe('shipped behaviors')
  })
})

describe('StepPersonality — markdown mode toggle', () => {
  it('switches to markdown view and back, preserving content', () => {
    const onChange = vi.fn()
    const { rerender } = render(<StepPersonality profile={DEFAULTS} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: /markdown/i }))
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0] as ProfileDraft
    expect(lastCall.view_mode).toBe('markdown')

    rerender(<StepPersonality profile={lastCall} onChange={onChange} />)
    expect(screen.getByText(/## Identity/)).toBeInTheDocument()
  })
})

describe('profileSubmitPayload', () => {
  it('produces the documented wire format', () => {
    const payload = profileSubmitPayload(DEFAULTS)
    expect(payload).toEqual({
      name: 'Prime',
      soul: {
        identity: 'shipped identity',
        voice_tone: 'shipped voice',
        decision_style: 'shipped decision',
      },
      operating: {
        default_behaviors: 'shipped behaviors',
        approval_thresholds: 'shipped approval',
      },
    })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run tests/pages/Setup.personality.test.tsx`
Expected: FAIL — exports `StepPersonality`, `ProfileDraft`, `profileSubmitPayload`, `INITIAL_PROFILE_STATE` do not exist yet.

- [ ] **Step 3: Replace the Personality step in `Setup.tsx`**

In `web/src/pages/Setup.tsx`, make these structural changes (the file is large; use `grep -n` to locate each):

(a) Add types near the other interfaces (after `PersonaDraft`):

```ts
export interface ProfileSectionSet {
  identity: string
  voice_tone: string
  decision_style: string
  default_behaviors: string
  approval_thresholds: string
}

export interface ProfileDraft {
  name: string
  view_mode: 'sections' | 'markdown'
  soul: { identity: string; voice_tone: string; decision_style: string }
  operating: { default_behaviors: string; approval_thresholds: string }
  shipped_defaults: ProfileSectionSet
}

export const INITIAL_PROFILE_STATE: ProfileDraft = {
  name: 'Prime',
  view_mode: 'sections',
  soul:      { identity: '', voice_tone: '', decision_style: '' },
  operating: { default_behaviors: '', approval_thresholds: '' },
  shipped_defaults: {
    identity: '', voice_tone: '', decision_style: '',
    default_behaviors: '', approval_thresholds: '',
  },
}
```

(b) Replace `PersonaDraft` in `WizardState` with `profile: ProfileDraft`. Update `INITIAL_STATE`:

```ts
const INITIAL_STATE: WizardState = {
  providers: [...],   // unchanged
  routing:   { planning: [], dispatching: [], discussion: [] },
  profile:   INITIAL_PROFILE_STATE,
  rules:     { presets: [], custom: '' },
  costControls: { monthlyTokenBudget: 0 },
  workspace: { mode: 'local', root_path: '../.agent-workspace', branch: 'main' },
}
```

Delete the `persona` field from `WizardState` and all references to it. The previous tone preset goes away (it becomes part of the editable Voice & Tone section).

(c) On wizard mount, fetch the profile defaults from the new API so we know what's shipped. In the `Setup` component, add a `useEffect` that calls `fetchPrimeProfile()` (from `web/src/api.ts`, added in Task 10) and seeds both `profile.shipped_defaults` AND any blank sections with the shipped values.

(d) Replace `StepPersonality` (around line 847) with:

```tsx
const SECTION_LABELS: Record<keyof ProfileSectionSet, string> = {
  identity: 'Identity',
  voice_tone: 'Voice & Tone',
  decision_style: 'Decision Style',
  default_behaviors: 'Default Behaviors',
  approval_thresholds: 'Approval Thresholds',
}

const SOUL_KEYS: (keyof ProfileSectionSet)[] = ['identity', 'voice_tone', 'decision_style']
const OP_KEYS: (keyof ProfileSectionSet)[] = ['default_behaviors', 'approval_thresholds']

function getSection(profile: ProfileDraft, key: keyof ProfileSectionSet): string {
  if (SOUL_KEYS.includes(key)) return profile.soul[key as keyof ProfileDraft['soul']]
  return profile.operating[key as keyof ProfileDraft['operating']]
}

function withSection(profile: ProfileDraft, key: keyof ProfileSectionSet, value: string): ProfileDraft {
  if (SOUL_KEYS.includes(key)) {
    return { ...profile, soul: { ...profile.soul, [key]: value } }
  }
  return { ...profile, operating: { ...profile.operating, [key]: value } }
}

export function StepPersonality({ profile, onChange }: { profile: ProfileDraft; onChange: (next: ProfileDraft) => void }) {
  const setMode = (mode: ProfileDraft['view_mode']) => onChange({ ...profile, view_mode: mode })

  const clearAll = () => onChange({
    ...profile,
    soul: { identity: '', voice_tone: '', decision_style: '' },
    operating: { default_behaviors: '', approval_thresholds: '' },
  })

  const resetAll = () => onChange({
    ...profile,
    soul: {
      identity:       profile.shipped_defaults.identity,
      voice_tone:     profile.shipped_defaults.voice_tone,
      decision_style: profile.shipped_defaults.decision_style,
    },
    operating: {
      default_behaviors:   profile.shipped_defaults.default_behaviors,
      approval_thresholds: profile.shipped_defaults.approval_thresholds,
    },
  })

  const renderSectionField = (key: keyof ProfileSectionSet) => {
    const value = getSection(profile, key)
    const diverges = value.trim() !== profile.shipped_defaults[key].trim()
    return (
      <div key={key}>
        <label className={LABEL_CLS}>{SECTION_LABELS[key]}</label>
        <textarea
          aria-label={SECTION_LABELS[key]}
          value={value}
          onChange={(e) => onChange(withSection(profile, key, e.target.value))}
          rows={6}
          className={INPUT_CLS + ' resize-y'}
        />
        {diverges && (
          <button
            type="button"
            onClick={() => onChange(withSection(profile, key, profile.shipped_defaults[key]))}
            aria-label={`Reset ${SECTION_LABELS[key]}`}
            className="mt-1 text-xs text-[var(--muted)] hover:text-[var(--text)] underline"
          >
            Reset {SECTION_LABELS[key]} to default
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div className="flex-1">
          <label className={LABEL_CLS}>Name</label>
          <input
            value={profile.name}
            onChange={(e) => onChange({ ...profile, name: e.target.value })}
            placeholder="Prime"
            className={INPUT_CLS}
          />
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setMode('sections')}
            className={`px-3 py-1.5 text-xs rounded border transition ${profile.view_mode === 'sections' ? 'border-[#6ee7ff] bg-[#1f6feb] text-white' : 'border-[var(--border-soft)] text-[var(--muted)]'}`}
          >
            Sections
          </button>
          <button
            type="button"
            onClick={() => setMode('markdown')}
            className={`px-3 py-1.5 text-xs rounded border transition ${profile.view_mode === 'markdown' ? 'border-[#6ee7ff] bg-[#1f6feb] text-white' : 'border-[var(--border-soft)] text-[var(--muted)]'}`}
          >
            Markdown
          </button>
        </div>
      </div>

      {profile.view_mode === 'sections' ? (
        <>
          <fieldset className="rounded-lg border border-[var(--border-soft)] p-3 space-y-3">
            <legend className="px-1 text-xs uppercase tracking-[0.14em] text-[var(--muted)]">Who Prime is</legend>
            {SOUL_KEYS.map(renderSectionField)}
          </fieldset>
          <fieldset className="rounded-lg border border-[var(--border-soft)] p-3 space-y-3">
            <legend className="px-1 text-xs uppercase tracking-[0.14em] text-[var(--muted)]">How Prime works here</legend>
            {OP_KEYS.map(renderSectionField)}
          </fieldset>
        </>
      ) : (
        <>
          <div>
            <label className={LABEL_CLS}>prime-soul.md</label>
            <textarea
              aria-label="prime-soul markdown"
              value={renderSoulMarkdown(profile)}
              onChange={(e) => onChange(applySoulMarkdown(profile, e.target.value))}
              rows={14}
              className={INPUT_CLS + ' font-mono text-xs resize-y'}
            />
          </div>
          <div>
            <label className={LABEL_CLS}>prime.md</label>
            <textarea
              aria-label="prime operating markdown"
              value={renderOperatingMarkdown(profile)}
              onChange={(e) => onChange(applyOperatingMarkdown(profile, e.target.value))}
              rows={14}
              className={INPUT_CLS + ' font-mono text-xs resize-y'}
            />
          </div>
        </>
      )}

      <div className="flex flex-wrap gap-3 pt-2">
        <button type="button" onClick={clearAll} className={BTN_SECONDARY}>Clear all (start from scratch)</button>
        <button type="button" onClick={resetAll} className={BTN_SECONDARY}>Reset all to defaults</button>
      </div>
    </div>
  )
}

function renderSoulMarkdown(p: ProfileDraft): string {
  const parts: string[] = []
  if (p.soul.identity.trim())       parts.push(`## Identity\n${p.soul.identity.trim()}`)
  if (p.soul.voice_tone.trim())     parts.push(`## Voice & Tone\n${p.soul.voice_tone.trim()}`)
  if (p.soul.decision_style.trim()) parts.push(`## Decision Style\n${p.soul.decision_style.trim()}`)
  return parts.join('\n\n') + (parts.length ? '\n' : '')
}

function renderOperatingMarkdown(p: ProfileDraft): string {
  const parts: string[] = []
  if (p.operating.default_behaviors.trim())   parts.push(`## Default Behaviors\n${p.operating.default_behaviors.trim()}`)
  if (p.operating.approval_thresholds.trim()) parts.push(`## Approval Thresholds\n${p.operating.approval_thresholds.trim()}`)
  return parts.join('\n\n') + (parts.length ? '\n' : '')
}

function applySoulMarkdown(p: ProfileDraft, md: string): ProfileDraft {
  const sections = parseMdSections(md, { identity: 'Identity', voice_tone: 'Voice & Tone', decision_style: 'Decision Style' })
  return { ...p, soul: {
    identity:       sections.identity ?? '',
    voice_tone:     sections.voice_tone ?? '',
    decision_style: sections.decision_style ?? '',
  } }
}

function applyOperatingMarkdown(p: ProfileDraft, md: string): ProfileDraft {
  const sections = parseMdSections(md, { default_behaviors: 'Default Behaviors', approval_thresholds: 'Approval Thresholds' })
  return { ...p, operating: {
    default_behaviors:   sections.default_behaviors ?? '',
    approval_thresholds: sections.approval_thresholds ?? '',
  } }
}

function parseMdSections(md: string, headingMap: Record<string, string>): Record<string, string> {
  const lower: Record<string, string> = {}
  for (const [key, heading] of Object.entries(headingMap)) lower[heading.toLowerCase()] = key
  const out: Record<string, string> = {}
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  let currentKey: string | null = null
  let buf: string[] = []
  const flush = () => {
    if (currentKey) out[currentKey] = buf.join('\n').replace(/^\n+|\n+$/g, '')
    buf = []
  }
  for (const line of lines) {
    const m = /^##\s+(.+?)\s*$/.exec(line)
    if (m) {
      flush()
      currentKey = lower[m[1].trim().toLowerCase()] ?? null
      continue
    }
    if (currentKey) buf.push(line)
  }
  flush()
  return out
}

export function profileSubmitPayload(p: ProfileDraft) {
  return {
    name: p.name,
    soul: {
      identity:       p.soul.identity,
      voice_tone:     p.soul.voice_tone,
      decision_style: p.soul.decision_style,
    },
    operating: {
      default_behaviors:   p.operating.default_behaviors,
      approval_thresholds: p.operating.approval_thresholds,
    },
  }
}
```

(e) Update `handleSubmit` (around line 1212) to send `profile: profileSubmitPayload(state.profile)` instead of the old `persona` field.

(f) Update `stepProgress(state, 3)` (around line 155) to score the new fields:

```ts
if (step === 3) {
  let score = 0
  if (state.profile.name.trim()) score += 0.2
  const sections: (keyof ProfileSectionSet)[] = ['identity', 'voice_tone', 'decision_style', 'default_behaviors', 'approval_thresholds']
  for (const key of sections) {
    const val = SOUL_KEYS.includes(key) ? (state.profile.soul as Record<string, string>)[key] : (state.profile.operating as Record<string, string>)[key]
    if (val?.trim()) score += 0.16
  }
  return clamp01(score)
}
```

(g) Update `StepLaunch` summary block (around line 1112) so the Personality summary references the new structure (just show "Name: X", "Voice & Tone: <first 80 chars>…").

- [ ] **Step 4: Wire the fetch into the Setup component**

Inside `Setup`, add:

```ts
useEffect(() => {
  fetchPrimeProfile().then((res) => {
    setState((current) => ({
      ...current,
      profile: {
        ...current.profile,
        name: res.name,
        soul: res.soul,
        operating: res.operating,
        shipped_defaults: res.shipped_defaults,
      },
    }))
  }).catch(() => { /* keep wizard defaults */ })
}, [])
```

- [ ] **Step 5: Run the new frontend tests**

Run: `cd web && npx vitest run tests/pages/Setup.personality.test.tsx`
Expected: PASS.

- [ ] **Step 6: Run the frontend build**

Run: `cd web && npm run build`
Expected: build succeeds with no type errors.

- [ ] **Step 7: Commit**

```bash
git add web/src/pages/Setup.tsx web/tests/pages/Setup.personality.test.tsx
git commit -m "feat(setup): structured profile editor with sections/markdown toggle"
```

---

## Task 12: End-to-end manual verification

This task has no code. Run through the user-facing flow to catch what tests don't.

- [ ] **Step 1: Start the dev stack**

Run: `scripts/dev-up.sh`
Wait until both backend and frontend report ready.

- [ ] **Step 2: Reset to a fresh-setup state**

Run via psql (or whatever the dev DB access pattern is):

```sql
DELETE FROM providers WHERE NOT (type = 'codex' AND name = 'Codex (local)');
UPDATE prime_agent_config SET setup_complete = false WHERE id = 'default';
DELETE FROM thread_messages;
DELETE FROM threads;
```

Also remove the workspace `agents/` directory so the scaffolder seeds fresh:

```sh
rm -rf .agent-workspace/agents
```

- [ ] **Step 3: Walk the setup wizard**

Open the UI, complete the wizard end-to-end:
- Verify the Personality step shows the rich defaults pre-filled.
- Edit one section. Verify the "Reset" link appears for only that section.
- Click "Clear all". Verify every section blanks. Click "Reset all". Verify defaults restored.
- Toggle to Markdown. Verify both files render correctly with `## Section` headings. Edit a heading-less paragraph. Toggle back. Verify the section was preserved.
- Launch.

- [ ] **Step 4: Verify the onboarding thread greeting**

Open the onboarding room in the UI. The greeting should be one assistant message containing:
- Prime's name as sender.
- A synopsis paragraph mentioning "direct" / "decisive" / "escalate" / "adjust".

- [ ] **Step 5: Verify conversational refinement**

In the onboarding thread, send: *"Be a bit more cautious — I want you to pause before every PR comment, not just outbound emails."*

Expect Prime to:
- Respond conversationally.
- Emit an `update_profile` action targeting `approval_thresholds`.
- A second message appears showing the diff with the updated approval threshold body.

Verify the file changed:

```sh
cat .agent-workspace/agents/prime.md | grep -A 2 "PR comment"
```

- [ ] **Step 6: Verify "start from scratch" via chat**

Send: *"Reset your profile to defaults."*

Expect Prime to emit one `update_profile` action per non-default section. Verify the workspace files now match the shipped templates.

- [ ] **Step 7: If anything failed, file a follow-up**

Document each broken behavior in `progress.md` for triage rather than burying it in commits. Do not declare the feature done until every checkbox in steps 3–6 worked.

---

## Plan self-review summary

Coverage of spec sections:
- Default content → Tasks 2, 5 (the test asserts shipped sections parse cleanly).
- Parser / renderer → Task 1.
- Workspace template loading → Task 3.
- System prompt injection → Task 4.
- Profile API endpoints + legacy materialization → Task 5.
- Setup endpoint structured profile + legacy compat → Task 6.
- `update_profile` action with diff + event → Task 7.
- System prompt documentation of the new action + onboarding tour → Task 8.
- Onboarding greeting with synopsis → Task 9.
- Frontend types and API client → Task 10.
- Wizard rewrite (sections, markdown toggle, reset, clear) → Task 11.
- End-to-end verification → Task 12.

No placeholders. No "implement later". Every code step includes the actual code.
