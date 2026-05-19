/**
 * Model capability assessment for Prime Agent routing.
 *
 * Maps known model names/families to estimated parameter counts and
 * classifies them into capability tiers used by Prime's decision-making
 * requirements.
 *
 * Thresholds:
 * - ≥ 7B params: recommended for Prime (reliable JSON, reasoning)
 * - 3B–7B params: allowed but warned (condensed prompt path)
 * - < 3B params: blocked from Prime routing
 */

// ─── Known model parameter estimates ──────────────────────────────────────────

interface ModelEntry {
  /** Estimated parameter count in billions */
  params: number
  /** Whether the model supports JSON mode / structured output natively */
  jsonMode: boolean
}

/**
 * Pattern-based lookup for known models.
 * Keys are case-insensitive substrings to match against model names.
 * Order matters — first match wins, so more specific patterns go first.
 */
const KNOWN_MODELS: Array<{ pattern: RegExp; entry: ModelEntry }> = [
  // ── Anthropic Claude ───────────────────────────────────────────────────
  { pattern: /claude-4\.-?sonnet/i, entry: { params: 300, jsonMode: true } },   // estimated
  { pattern: /claude-4\.-?opus/i, entry: { params: 500, jsonMode: true } },     // estimated
  { pattern: /claude-4\.-?haiku/i, entry: { params: 15, jsonMode: true } },     // estimated
  { pattern: /claude-3\.5-sonnet|sonnet-4/i, entry: { params: 200, jsonMode: true } },
  { pattern: /claude-3-opus/i, entry: { params: 100, jsonMode: true } },
  { pattern: /claude-3-sonnet/i, entry: { params: 80, jsonMode: true } },
  { pattern: /claude-3-haiku/i, entry: { params: 20, jsonMode: true } },
  { pattern: /claude-2/i, entry: { params: 60, jsonMode: false } },

  // ── OpenAI GPT ─────────────────────────────────────────────────────────
  { pattern: /gpt-4o/i, entry: { params: 200, jsonMode: true } },
  { pattern: /gpt-4-turbo/i, entry: { params: 100, jsonMode: true } },
  { pattern: /gpt-4\b/i, entry: { params: 100, jsonMode: true } },
  { pattern: /gpt-3\.5/i, entry: { params: 13, jsonMode: true } },

  // ── Llama family (Meta) ────────────────────────────────────────────────
  { pattern: /llama-4|llama4/i, entry: { params: 200, jsonMode: true } },
  { pattern: /llama-3\.3-70b|llama3\.3-70b/i, entry: { params: 70, jsonMode: true } },
  { pattern: /llama-3\.1-405b|llama3\.1-405b/i, entry: { params: 405, jsonMode: true } },
  { pattern: /llama-3\.1-70b|llama3\.1-70b/i, entry: { params: 70, jsonMode: true } },
  { pattern: /llama-3\.1-8b|llama3\.1-8b/i, entry: { params: 8, jsonMode: true } },
  { pattern: /llama-3-70b|llama3-70b/i, entry: { params: 70, jsonMode: true } },
  { pattern: /llama-3-8b|llama3-8b/i, entry: { params: 8, jsonMode: true } },
  { pattern: /llama-3\.2-90b|llama3\.2-90b/i, entry: { params: 90, jsonMode: true } },
  { pattern: /llama-3\.2-11b|llama3\.2-11b/i, entry: { params: 11, jsonMode: true } },
  { pattern: /llama-3\.2-8b|llama3\.2-8b/i, entry: { params: 8, jsonMode: true } },
  { pattern: /llama-3\.2-3b|llama3\.2-3b/i, entry: { params: 3, jsonMode: false } },
  { pattern: /llama-3\.1-70b|llama3\.1-70b/i, entry: { params: 70, jsonMode: true } },

  // ── Qwen family (Alibaba) ──────────────────────────────────────────────
  { pattern: /qwen2\.5-coder-32b|qwen2\.5-32b/i, entry: { params: 32, jsonMode: true } },
  { pattern: /qwen2\.5-72b|qwen2-72b/i, entry: { params: 72, jsonMode: true } },
  { pattern: /qwen2\.5-32b|qwen2-32b/i, entry: { params: 32, jsonMode: true } },
  { pattern: /qwen2\.5-14b|qwen2-14b/i, entry: { params: 14, jsonMode: true } },
  { pattern: /qwen2\.5-7b|qwen2-7b/i, entry: { params: 7, jsonMode: true } },
  { pattern: /qwen2\.5-3b|qwen2-3b/i, entry: { params: 3, jsonMode: false } },
  { pattern: /qwen2\.5-1\.5b|qwen2-1\.5b/i, entry: { params: 1.5, jsonMode: false } },
  { pattern: /qwen2\.5-0\.5b|qwen2-0\.5b/i, entry: { params: 0.5, jsonMode: false } },

  // ── Mistral family ─────────────────────────────────────────────────────
  { pattern: /mistral-large/i, entry: { params: 123, jsonMode: true } },
  { pattern: /mixtral-8x22b/i, entry: { params: 141, jsonMode: true } },
  { pattern: /mixtral-8x7b/i, entry: { params: 46.7, jsonMode: true } },
  { pattern: /mistral-small-3/i, entry: { params: 24, jsonMode: true } },
  { pattern: /mistral-7b|mistral-nemo-12b/i, entry: { params: 12, jsonMode: true } },

  // ── Gemma family (Google) ──────────────────────────────────────────────
  { pattern: /gemma-2-27b|gemma2-27b/i, entry: { params: 27, jsonMode: true } },
  { pattern: /gemma-2-9b|gemma2-9b/i, entry: { params: 9, jsonMode: true } },
  { pattern: /gemma-2-2b|gemma2-2b/i, entry: { params: 2, jsonMode: false } },

  // ── DeepSeek ───────────────────────────────────────────────────────────
  { pattern: /deepseek-v3/i, entry: { params: 671, jsonMode: true } },
  { pattern: /deepseek-r1-671b/i, entry: { params: 671, jsonMode: true } },
  { pattern: /deepseek-r1-distill-qwen-32b/i, entry: { params: 32, jsonMode: true } },
  { pattern: /deepseek-r1-distill-qwen-14b/i, entry: { params: 14, jsonMode: true } },
  { pattern: /deepseek-r1-distill-qwen-7b/i, entry: { params: 7, jsonMode: true } },
  { pattern: /deepseek-r1-distill-llama-70b/i, entry: { params: 70, jsonMode: true } },
  { pattern: /deepseek-r1-distill-llama-8b/i, entry: { params: 8, jsonMode: true } },
  { pattern: /deepseek-coder-v2|deepseek-v2/i, entry: { params: 236, jsonMode: true } },

  // ── Command-R (Cohere) ─────────────────────────────────────────────────
  { pattern: /command-r\+-?70b|command-r\+/i, entry: { params: 104, jsonMode: true } },
  { pattern: /command-r/i, entry: { params: 35, jsonMode: true } },

  // ── Phi family (Microsoft) ─────────────────────────────────────────────
  { pattern: /phi-4/i, entry: { params: 14, jsonMode: true } },
  { pattern: /phi-3\.5-mini|phi-3\.5-vision/i, entry: { params: 4.2, jsonMode: false } },
  { pattern: /phi-3-mini/i, entry: { params: 3.8, jsonMode: false } },

  // ── General number-based fallback patterns ─────────────────────────────
  // These catch model names that embed the size directly (e.g., "my-model-13b")
  { pattern: /(\d+(?:\.\d+)?)\s*b$/i, entry: null! }, // handled dynamically below
]

// ─── Capability tiers ────────────────────────────────────────────────────────

export type ModelTier = 'recommended' | 'warned' | 'blocked'

export interface ModelCapabilityAssessment {
  /** The input model name */
  model: string
  /** Estimated parameter count in billions (0 if unknown) */
  estimatedParams: number | null
  /** Whether the model supports JSON mode / structured output */
  jsonMode: boolean
  /** Capability tier classification */
  tier: ModelTier
  /** Human-readable warning message (empty for recommended tier) */
  warning: string
  /** Whether this model should be blocked from Prime routing */
  isBlocked: boolean
}

/** Minimum parameter thresholds */
const PARAMS_BLOCK_THRESHOLD = 3   // < 3B → blocked
const PARAMS_WARN_THRESHOLD = 7   // < 7B → warned (but allowed)

export function assessModelCapability(modelName: string): ModelCapabilityAssessment {
  if (!modelName || !modelName.trim()) {
    return {
      model: modelName ?? '',
      estimatedParams: null,
      jsonMode: false,
      tier: 'warned',
      warning: 'No model name specified. Cannot assess capability. Recommended: 7B+ parameters with JSON mode support.',
      isBlocked: false,
    }
  }

  const name = modelName.trim()
  let params: number | null = null
  let jsonMode = false

  // 1. Check known model patterns (first match wins)
  for (const { pattern, entry } of KNOWN_MODELS) {
    if (!pattern) continue
    const match = name.match(pattern)
    if (match) {
      // Handle dynamic size extraction from general patterns
      if (entry === null) {
        const sizeMatch = name.match(/(\d+(?:\.\d+)?)\s*b$/i)
        if (sizeMatch) {
          params = parseFloat(sizeMatch[1])
          jsonMode = params >= 7
        }
      } else {
        params = entry.params
        jsonMode = entry.jsonMode
      }
      break
    }
  }

  // 2. Try to extract size from model name as fallback (e.g., "mistral-7b-instruct")
  if (params === null) {
    const sizeMatch = name.match(/(\d+(?:\.\d+)?)\s*b(?:\w*)$/i)
    if (sizeMatch) {
      params = parseFloat(sizeMatch[1])
      jsonMode = params >= 7
    }
  }

  // 3. Classify into tier
  const tier = classifyTier(params, jsonMode)
  const warning = buildWarning(tier, params, jsonMode)

  return {
    model: name,
    estimatedParams: params,
    jsonMode,
    tier,
    warning,
    isBlocked: tier === 'blocked',
  }
}

function classifyTier(params: number | null, _jsonMode: boolean): ModelTier {
  if (params === null) return 'warned'
  if (params < PARAMS_BLOCK_THRESHOLD) return 'blocked'
  if (params < PARAMS_WARN_THRESHOLD) return 'warned'
  return 'recommended'
}

function buildWarning(tier: ModelTier, params: number | null, jsonMode: boolean): string {
  switch (tier) {
    case 'recommended':
      return ''
    case 'warned': {
      const parts: string[] = []
      if (params !== null && params < PARAMS_WARN_THRESHOLD) {
        parts.push(`${params}B parameters — this model may produce unreliable JSON output and low-quality decisions`)
      } else if (params === null) {
        parts.push('Unknown model — cannot verify capability')
      }
      if (!jsonMode) {
        parts.push('no native JSON mode support')
      }
      parts.push('Recommended: 7B+ parameters with JSON mode support for Prime Agent decision-making')
      return parts.join('. ')
    }
    case 'blocked': {
      const parts: string[] = []
      if (params !== null) {
        parts.push(`${params}B parameters is below the minimum threshold`)
      }
      parts.push('Models under 3B cannot reliably produce structured JSON or coherent reasoning')
      parts.push('This model is blocked from Prime Agent decision-making')
      return parts.join('. ')
    }
  }
}
