// Validator framework for catalog templates
//
// Orchestrates structural validation and resolves references.
// Returns FailureReason[] on rejection.

import type { CatalogTemplate, FailureReason, SyncEntryResult } from './types.js';

import { parseTemplateYaml } from './schema.js';
import { isWithinBaseline } from './baseline.js';
import { isKnownPrimitive } from './primitives.js';

// Validation context - external references to resolve
export interface ValidationContext {
  capabilityBundleAdapters: string[]; // Known bundle names
  mcpServers: string[]; // Known MCP server names
  providers: string[]; // Known provider names
  brokerCredentials: string[]; // Known broker credential names
}

/**
 * Full validation pipeline:
 * 1. Structural validation (schema.ts)
 * 2. Reference resolution (external services)
 * 3. Semantic validation (least-privilege, secret detection)
 * 4. Policy checks (approval downgrade → warning)
 *
 * Returns { errors, warnings }. A non-empty `errors` array means the template is
 * rejected. `warnings` (e.g. APPROVAL_POLICY_DOWNGRADED) do NOT reject the
 * template; they signal a policy adjustment (forced human approval).
 */
export async function validateTemplate(
  yamlContent: string,
  context: ValidationContext
): Promise<{ errors: FailureReason[]; warnings: FailureReason[] }> {
  const errors: FailureReason[] = [];
  const warnings: FailureReason[] = [];

  // Step 1: Structural validation
  const { template, errors: parseErrors } = parseTemplateYaml(yamlContent);
  if (parseErrors.length > 0) {
    return { errors: parseErrors, warnings };
  }
  if (!template) {
    return {
      errors: [{ code: 'INVALID_FIELD_TYPE', detail: 'Failed to parse template' }],
      warnings,
    };
  }

  // Step 2: Reference resolution
  errors.push(...(await resolveReferences(template, context)));

  // Step 3: Semantic validation (least-privilege, secret detection)
  errors.push(...validateSemantics(template, context));

  // Step 4: Approval-policy check (warning, not rejection).
  // autoEligible declared but template is NOT within the safe baseline →
  // forced to human approval (APPROVAL_POLICY_DOWNGRADED).
  if (template.approvalPolicy?.autoEligible && !isWithinBaseline(template)) {
    warnings.push({
      code: 'APPROVAL_POLICY_DOWNGRADED',
      field: 'approvalPolicy.autoEligible',
      detail: 'autoEligible requested but grants exceed safe baseline; forced to human approval',
    });
  }

  return { errors, warnings };
}

/**
 * Resolve external references and check they exist.
 */
async function resolveReferences(
  template: CatalogTemplate,
  context: ValidationContext
): Promise<FailureReason[]> {
  const errors: FailureReason[] = [];
  
  // Check capability bundles
  const bundles = template.capabilityProfile?.capabilityBundles || [];
  for (const bundle of bundles) {
    if (!context.capabilityBundleAdapters.includes(bundle)) {
      errors.push({ code: 'UNKNOWN_CAPABILITY_BUNDLE', field: 'capabilityProfile.capabilityBundles', detail: bundle });
    }
  }
  
  // Check platform primitives
  const primitives = template.capabilityProfile?.platformPrimitives || [];
  for (const primitive of primitives) {
    if (!isKnownPrimitive(primitive)) {
      errors.push({ code: 'UNKNOWN_PLATFORM_PRIMITIVE', field: 'capabilityProfile.platformPrimitives', detail: primitive });
    }
  }
  
  // Check MCP servers
  const mcpAccess = template.mcpAccess || [];
  for (const mcp of mcpAccess) {
    if (!context.mcpServers.includes(mcp)) {
      errors.push({ code: 'UNKNOWN_MCP_SERVER', field: 'mcpAccess', detail: mcp });
    }
  }
  
  // Check providers
  // (Would check providers if we had provider references in the template)
  
  // Check broker credentials
  const credentialNeeds = template.credentialNeeds || [];
  for (const cred of credentialNeeds) {
    if (!context.brokerCredentials.includes(cred)) {
      errors.push({ code: 'UNKNOWN_CREDENTIAL', field: 'credentialNeeds', detail: cred });
    }
  }
  
  return errors;
}

/**
 * Semantic validation rules (least-privilege, secret detection).
 *
 * All results here are genuine rejections (errors). Approval-policy downgrade is
 * handled separately in validateTemplate() as a warning.
 */
function validateSemantics(
  template: CatalogTemplate,
  context: ValidationContext
): FailureReason[] {
  const errors: FailureReason[] = [];

  // Least-privilege: tool/MCP access must not exceed the powers implied by the
  // declared capability profile.
  errors.push(...checkLeastPrivilege(template, context));

  // Inline secret values in prompt/soul/persona fields.
  errors.push(...checkForSecretValues(template));

  return errors;
}

/**
 * Least-privilege (FR-006 / FR-019).
 *
 * The effective runtime grant is the intersection of the template declaration and
 * runtime policy — a declaration must never widen authority. Mirrors
 * `resolveToolGrant` (backend/src/tool-grants.ts): tools and MCP servers are
 * provided by capability bundles (resolved to provider adapters via
 * capability_bundle_adapters). Platform primitives are control-plane tools.
 *
 * A LEAST_PRIVILEGE_VIOLATION is emitted only when a requested tool/MCP is
 * genuinely NOT enabled by any declared capability bundle/primitive:
 *  - the item is explicitly denied by the capability profile's denyRules, OR
 *  - the template requests tool/MCP access without declaring ANY capability
 *    bundle (no bundle ⇒ no provider adapter ⇒ no implied tool/MCP power).
 *
 * Normal templates that declare bundles for the tools/MCP they request do NOT
 * produce false positives.
 */
function checkLeastPrivilege(
  template: CatalogTemplate,
  _context: ValidationContext
): FailureReason[] {
  const errors: FailureReason[] = [];

  const profile = template.capabilityProfile || {};
  const declaredBundles = new Set(profile.capabilityBundles || []);
  const declaredPrimitives = new Set(profile.platformPrimitives || []);
  const denied = new Set(profile.denyRules || []);

  const hasAnyCapabilityPower =
    declaredBundles.size > 0 || declaredPrimitives.size > 0;

  // Tools are enabled by capability bundles. A tool is over-reach if it is
  // explicitly denied, or if no capability power is declared at all.
  const toolAccess = template.toolAccess || [];
  for (const tool of toolAccess) {
    if (denied.has(tool)) {
      errors.push({
        code: 'LEAST_PRIVILEGE_VIOLATION',
        field: 'toolAccess',
        detail: `Tool '${tool}' is explicitly denied by the capability profile`,
      });
    } else if (!hasAnyCapabilityPower) {
      errors.push({
        code: 'LEAST_PRIVILEGE_VIOLATION',
        field: 'toolAccess',
        detail: `Tool '${tool}' requested but no capability bundle/primitive is declared to grant it`,
      });
    }
  }

  // MCP servers are enabled by capability bundles. Same over-reach rule.
  const mcpAccess = template.mcpAccess || [];
  for (const mcp of mcpAccess) {
    if (denied.has(mcp)) {
      errors.push({
        code: 'LEAST_PRIVILEGE_VIOLATION',
        field: 'mcpAccess',
        detail: `MCP server '${mcp}' is explicitly denied by the capability profile`,
      });
    } else if (declaredBundles.size === 0) {
      errors.push({
        code: 'LEAST_PRIVILEGE_VIOLATION',
        field: 'mcpAccess',
        detail: `MCP server '${mcp}' requested but no capability bundle is declared to grant it`,
      });
    }
  }

  return errors;
}

// Patterns that indicate an actual secret VALUE (not a benign mention).
const SECRET_VALUE_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  // PEM private key blocks.
  { name: 'PEM private key', pattern: /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/ },
  // OpenAI-style keys (sk-...) and similar prefixed secret keys.
  { name: 'API key', pattern: /\bsk-[A-Za-z0-9_-]{16,}\b/ },
  // AWS access key IDs.
  { name: 'AWS access key', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  // GitHub tokens.
  { name: 'token', pattern: /\bgh[posru]_[A-Za-z0-9]{20,}\b/ },
  // Explicit assignment of a key/secret/password/token to a literal value.
  {
    name: 'inline credential assignment',
    pattern: /\b(?:api[_-]?key|secret|password|passwd|token|bearer)\b\s*[:=]\s*["']?[A-Za-z0-9._\-+/]{8,}["']?/i,
  },
  // Long high-entropy hex strings (>= 32 hex chars).
  { name: 'high-entropy hex', pattern: /\b[0-9a-fA-F]{32,}\b/ },
  // Long high-entropy base64-ish strings (>= 40 chars, mixed case + digits).
  { name: 'high-entropy base64', pattern: /\b(?=[A-Za-z0-9+/]*[A-Z])(?=[A-Za-z0-9+/]*[a-z])(?=[A-Za-z0-9+/]*[0-9])[A-Za-z0-9+/]{40,}={0,2}\b/ },
];

/**
 * Detect inline secret VALUES in prompt/soul/persona fields (FR-020).
 *
 * Only real secret-looking values are flagged. A prompt that merely mentions
 * words like "password" or "never log secrets" is NOT flagged.
 */
function checkForSecretValues(template: CatalogTemplate): FailureReason[] {
  const errors: FailureReason[] = [];

  const textFields: Array<{ field: string; value?: string }> = [
    { field: 'systemPrompt', value: template.systemPrompt },
    { field: 'soul', value: template.soul },
    { field: 'persona', value: template.persona },
  ];

  for (const { field, value } of textFields) {
    if (typeof value !== 'string' || value.length === 0) continue;
    for (const { name, pattern } of SECRET_VALUE_PATTERNS) {
      if (pattern.test(value)) {
        errors.push({
          code: 'SECRET_VALUE_PRESENT',
          field,
          detail: `Inline secret value detected in ${field} (${name})`,
        });
        break;
      }
    }
  }

  return errors;
}

/**
 * Check for duplicate template IDs in a sync batch.
 */
export function checkDuplicateTemplateIds(templates: CatalogTemplate[]): FailureReason[] {
  const seen = new Set<string>();
  const errors: FailureReason[] = [];
  
  for (const template of templates) {
    if (seen.has(template.templateId)) {
      errors.push({ code: 'DUPLICATE_TEMPLATE_ID', field: 'templateId', detail: template.templateId });
    }
    seen.add(template.templateId);
  }
  
  return errors;
}

/**
 * Check for version conflicts within a sync batch.
 *
 * VERSION_CONFLICT = the SAME templateId+version appears more than once. Two
 * DIFFERENT templates sharing a version string (e.g. both at "1.0.0") is NOT a
 * conflict — versions are scoped per templateId.
 */
export function checkDuplicateVersions(
  newTemplates: CatalogTemplate[]
): FailureReason[] {
  const seen = new Set<string>();
  const errors: FailureReason[] = [];

  for (const template of newTemplates) {
    const key = `${template.templateId}@${template.version}`;
    if (seen.has(key)) {
      errors.push({
        code: 'VERSION_CONFLICT',
        field: 'version',
        detail: `Version ${template.version} for template ${template.templateId} appears more than once in the sync batch`,
      });
    }
    seen.add(key);
  }

  return errors;
}

/**
 * Handle validation failures and determine rejection outcome.
 */
export function handleRejection(
  templateId: string,
  version: string,
  failureReasons: FailureReason[]
): SyncEntryResult {
  return {
    templateId,
    version,
    outcome: 'rejected',
    admissionState: 'rejected',
    failureReasons,
  };
}

/**
 * Group failures by type for better rejection messaging.
 */
export function categorizeFailures(reasons: FailureReason[]): Record<string, FailureReason[]> {
  const categories: Record<string, FailureReason[]> = {};
  
  for (const reason of reasons) {
    if (!categories[reason.code]) {
      categories[reason.code] = [];
    }
    categories[reason.code].push(reason);
  }
  
  return categories;
}

/**
 * Format rejection message for UI display.
 */
export function formatRejectionMessage(templateId: string, version: string, reasons: FailureReason[]): string {
  const categories = categorizeFailures(reasons);
  
  const parts: string[] = [];
  parts.push(`Template ${templateId}@${version} rejected`);
  
  for (const [code, failures] of Object.entries(categories)) {
    const details = failures.map(f => f.detail || f.field || 'unknown').join(', ');
    parts.push(`${code}: ${details}`);
  }
  
  return parts.join('; ');
}

/**
 * Check for version conflicts in a sync batch.
 */
export function checkVersionConflicts(
  existingVersions: Map<string, string>, // templateId -> currentVersion
  newTemplates: CatalogTemplate[]
): FailureReason[] {
  const errors: FailureReason[] = [];
  
  for (const template of newTemplates) {
    const key = `${template.templateId}:${template.version}`;
    if (existingVersions.has(key)) {
      errors.push({ code: 'VERSION_CONFLICT', field: 'version', detail: `Template ${template.templateId} already has version ${template.version}` });
    }
  }
  
  return errors;
}
