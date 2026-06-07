// Validator tests for Agent Catalog

import { describe, it, expect } from 'vitest';

import type { CatalogTemplate, FailureReason } from '../../src/catalog/types.js';
import {
  validateTemplate,
  checkDuplicateTemplateIds,
  checkDuplicateVersions,
  checkVersionConflicts,
  handleRejection,
  categorizeFailures,
  formatRejectionMessage,
  type ValidationContext,
} from '../../src/catalog/validator.js';

describe('Validator - Duplicate Detection', () => {
  it('detects duplicate template IDs in batch', () => {
    const templates: CatalogTemplate[] = [
      { templateId: 'template-1', name: 'Test 1', version: '1.0.0', agentType: 'test', runtimeFamily: 'opencode', lifecycleIntent: 'durable', capabilityProfile: {} },
      { templateId: 'template-1', name: 'Test 2', version: '1.0.1', agentType: 'test', runtimeFamily: 'opencode', lifecycleIntent: 'durable', capabilityProfile: {} },
    ];

    const errors = checkDuplicateTemplateIds(templates);
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe('DUPLICATE_TEMPLATE_ID');
  });

  it('allows unique template IDs', () => {
    const templates: CatalogTemplate[] = [
      { templateId: 'template-1', name: 'Test 1', version: '1.0.0', agentType: 'test', runtimeFamily: 'opencode', lifecycleIntent: 'durable', capabilityProfile: {} },
      { templateId: 'template-2', name: 'Test 2', version: '1.0.0', agentType: 'test', runtimeFamily: 'opencode', lifecycleIntent: 'durable', capabilityProfile: {} },
    ];

    const errors = checkDuplicateTemplateIds(templates);
    expect(errors).toHaveLength(0);
  });

  it('detects the same templateId+version appearing twice in a batch', () => {
    const templates: CatalogTemplate[] = [
      { templateId: 'template-1', name: 'Test 1', version: '1.0.0', agentType: 'test', runtimeFamily: 'opencode', lifecycleIntent: 'durable', capabilityProfile: {} },
      { templateId: 'template-1', name: 'Test 1 dup', version: '1.0.0', agentType: 'test', runtimeFamily: 'opencode', lifecycleIntent: 'durable', capabilityProfile: {} },
    ];

    const errors = checkDuplicateVersions(templates);
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe('VERSION_CONFLICT');
  });

  it('does NOT treat different templates sharing a version string as a conflict', () => {
    const templates: CatalogTemplate[] = [
      { templateId: 'template-1', name: 'Test 1', version: '1.0.0', agentType: 'test', runtimeFamily: 'opencode', lifecycleIntent: 'durable', capabilityProfile: {} },
      { templateId: 'template-2', name: 'Test 2', version: '1.0.0', agentType: 'test', runtimeFamily: 'opencode', lifecycleIntent: 'durable', capabilityProfile: {} },
    ];

    const errors = checkDuplicateVersions(templates);
    expect(errors).toHaveLength(0);
  });

  it('allows unique versions per template', () => {
    const templates: CatalogTemplate[] = [
      { templateId: 'template-1', name: 'Test 1', version: '1.0.0', agentType: 'test', runtimeFamily: 'opencode', lifecycleIntent: 'durable', capabilityProfile: {} },
      { templateId: 'template-1', name: 'Test 2', version: '1.0.1', agentType: 'test', runtimeFamily: 'opencode', lifecycleIntent: 'durable', capabilityProfile: {} },
    ];

    const errors = checkDuplicateVersions(templates);
    expect(errors).toHaveLength(0);
  });

  it('detects version conflicts with existing versions', () => {
    const existingVersions = new Map<string, string>([
      ['template-1:1.0.0', '1.0.0'],
    ]);

    const newTemplates: CatalogTemplate[] = [
      { templateId: 'template-1', name: 'Test 1', version: '1.0.0', agentType: 'test', runtimeFamily: 'opencode', lifecycleIntent: 'durable', capabilityProfile: {} },
    ];

    const errors = checkVersionConflicts(existingVersions, newTemplates);
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe('VERSION_CONFLICT');
  });
});

describe('Validator - Rejection Handling', () => {
  it('handles rejection with failure reasons', () => {
    const failures: FailureReason[] = [
      { code: 'UNKNOWN_CAPABILITY_BUNDLE', field: 'capabilityProfile', detail: 'Unknown bundle' },
    ];

    const result = handleRejection('template-1', '1.0.0', failures);
    expect(result.outcome).toBe('rejected');
    expect(result.admissionState).toBe('rejected');
    expect(result.failureReasons).toBe(failures);
  });

  it('categorizes failures by code', () => {
    const failures: FailureReason[] = [
      { code: 'UNKNOWN_CAPABILITY_BUNDLE', field: 'field1' },
      { code: 'UNKNOWN_CAPABILITY_BUNDLE', field: 'field2' },
      { code: 'LEAST_PRIVILEGE_VIOLATION', field: 'field3' },
    ];

    const categories = categorizeFailures(failures);
    expect(categories['UNKNOWN_CAPABILITY_BUNDLE']).toHaveLength(2);
    expect(categories['LEAST_PRIVILEGE_VIOLATION']).toHaveLength(1);
  });

  it('formats rejection message for UI', () => {
    const failures: FailureReason[] = [
      { code: 'UNKNOWN_CAPABILITY_BUNDLE', detail: 'Bundle not found' },
      { code: 'LEAST_PRIVILEGE_VIOLATION', detail: 'Excessive access' },
    ];

    const message = formatRejectionMessage('template-1', '1.0.0', failures);
    expect(message).toContain('template-1@1.0.0 rejected');
    expect(message).toContain('UNKNOWN_CAPABILITY_BUNDLE');
    expect(message).toContain('LEAST_PRIVILEGE_VIOLATION');
  });
});

// A permissive validation context so reference resolution does not interfere
// with the semantic assertions under test.
const CTX: ValidationContext = {
  capabilityBundleAdapters: ['repo.read', 'repo.write', 'ci.inspect'],
  mcpServers: ['hister', 'director'],
  providers: ['anthropic'],
  brokerCredentials: ['github-token'],
};

function codes(reasons: FailureReason[]): string[] {
  return reasons.map((r) => r.code);
}

describe('Validator - Reference Resolution', () => {
  it('accepts real platform primitives', async () => {
    const yaml = `
templateId: real-primitives
name: Real Primitives
version: 1.0.0
agentType: opencode
runtimeFamily: opencode
lifecycleIntent: durable
capabilityProfile:
  platformPrimitives: [update_work_item, soul.read, memory.read, memory.write, delegate, request_approval, context.assemble, loop.inspect]
  capabilityBundles: [repo.read]
`;
    const { errors } = await validateTemplate(yaml, CTX);
    expect(codes(errors)).not.toContain('UNKNOWN_PLATFORM_PRIMITIVE');
  });

  it('rejects a nonsense platform primitive', async () => {
    const yaml = `
templateId: bad-primitive
name: Bad Primitive
version: 1.0.0
agentType: opencode
runtimeFamily: opencode
lifecycleIntent: durable
capabilityProfile:
  platformPrimitives: [totally-made-up-primitive]
  capabilityBundles: [repo.read]
`;
    const { errors } = await validateTemplate(yaml, CTX);
    expect(codes(errors)).toContain('UNKNOWN_PLATFORM_PRIMITIVE');
  });

  it('emits UNKNOWN_CREDENTIAL only when the broker does not know the credential', async () => {
    const known = `
templateId: known-cred
name: Known Cred
version: 1.0.0
agentType: opencode
runtimeFamily: opencode
lifecycleIntent: durable
capabilityProfile:
  platformPrimitives: [soul.read]
  capabilityBundles: [repo.read]
credentialNeeds: [github-token]
`;
    const knownResult = await validateTemplate(known, CTX);
    // Declaring a credentialNeed the broker knows is legitimate — no failures.
    expect(codes(knownResult.errors)).not.toContain('UNKNOWN_CREDENTIAL');
    expect(codes(knownResult.errors)).not.toContain('LEAST_PRIVILEGE_VIOLATION');

    const unknown = `
templateId: unknown-cred
name: Unknown Cred
version: 1.0.0
agentType: opencode
runtimeFamily: opencode
lifecycleIntent: durable
capabilityProfile:
  platformPrimitives: [soul.read]
  capabilityBundles: [repo.read]
credentialNeeds: [mystery-secret]
`;
    const unknownResult = await validateTemplate(unknown, CTX);
    expect(codes(unknownResult.errors)).toContain('UNKNOWN_CREDENTIAL');
  });
});

describe('Validator - Semantic Checks', () => {
  it('does NOT flag a normal template that declares bundles for its tools/MCP (least-privilege true negative)', async () => {
    const yaml = `
templateId: research-specialist
name: Research Specialist
version: 1.0.0
agentType: opencode
runtimeFamily: opencode
lifecycleIntent: ephemeral
capabilityProfile:
  platformPrimitives: [update_work_item, soul.read, memory.read]
  capabilityBundles: [repo.read]
toolAccess: [grep, read]
mcpAccess: [hister]
`;
    const { errors } = await validateTemplate(yaml, CTX);
    expect(codes(errors)).not.toContain('LEAST_PRIVILEGE_VIOLATION');
  });

  it('flags least-privilege when tools/MCP are requested with no capability bundle declared (true positive)', async () => {
    const yaml = `
templateId: overreach
name: Overreach
version: 1.0.0
agentType: opencode
runtimeFamily: opencode
lifecycleIntent: durable
capabilityProfile:
  platformPrimitives: []
  capabilityBundles: []
toolAccess: [shell]
mcpAccess: [hister]
`;
    const { errors } = await validateTemplate(yaml, CTX);
    expect(codes(errors)).toContain('LEAST_PRIVILEGE_VIOLATION');
  });

  it('flags least-privilege when a requested tool is explicitly denied (true positive)', async () => {
    const yaml = `
templateId: denied-tool
name: Denied Tool
version: 1.0.0
agentType: opencode
runtimeFamily: opencode
lifecycleIntent: durable
capabilityProfile:
  platformPrimitives: [soul.read]
  capabilityBundles: [repo.read]
  denyRules: [write]
toolAccess: [write]
`;
    const { errors } = await validateTemplate(yaml, CTX);
    expect(codes(errors)).toContain('LEAST_PRIVILEGE_VIOLATION');
  });

  it('does NOT treat declaring credentialNeeds as a least-privilege violation', async () => {
    const yaml = `
templateId: cred-ok
name: Cred OK
version: 1.0.0
agentType: opencode
runtimeFamily: opencode
lifecycleIntent: durable
capabilityProfile:
  platformPrimitives: [soul.read]
  capabilityBundles: [repo.read]
credentialNeeds: [github-token]
`;
    const { errors } = await validateTemplate(yaml, CTX);
    expect(codes(errors)).not.toContain('LEAST_PRIVILEGE_VIOLATION');
  });

  it('detects an inline secret VALUE in a prompt field (true positive)', async () => {
    const yaml = `
templateId: leaky
name: Leaky
version: 1.0.0
agentType: opencode
runtimeFamily: opencode
lifecycleIntent: durable
capabilityProfile:
  platformPrimitives: [soul.read]
  capabilityBundles: [repo.read]
systemPrompt: "Authenticate using sk-ABCDEF0123456789abcdef0123 for the API."
`;
    const { errors } = await validateTemplate(yaml, CTX);
    expect(codes(errors)).toContain('SECRET_VALUE_PRESENT');
  });

  it('does NOT flag a benign mention of secrets/passwords (true negative)', async () => {
    const yaml = `
templateId: careful
name: Careful
version: 1.0.0
agentType: opencode
runtimeFamily: opencode
lifecycleIntent: durable
capabilityProfile:
  platformPrimitives: [soul.read]
  capabilityBundles: [repo.read]
systemPrompt: "Never log passwords or API keys. Treat all secrets as sensitive and use the broker token mechanism."
`;
    const { errors } = await validateTemplate(yaml, CTX);
    expect(codes(errors)).not.toContain('SECRET_VALUE_PRESENT');
  });
});

describe('Validator - Approval Policy', () => {
  it('emits APPROVAL_POLICY_DOWNGRADED as a WARNING (not an error) when autoEligible exceeds the safe baseline', async () => {
    const yaml = `
templateId: wants-auto
name: Wants Auto
version: 1.0.0
agentType: opencode
runtimeFamily: opencode
lifecycleIntent: durable
capabilityProfile:
  platformPrimitives: [soul.read]
  capabilityBundles: [repo.write]
approvalPolicy:
  autoEligible: true
`;
    const { errors, warnings } = await validateTemplate(yaml, CTX);
    expect(codes(warnings)).toContain('APPROVAL_POLICY_DOWNGRADED');
    expect(codes(errors)).not.toContain('APPROVAL_POLICY_DOWNGRADED');
  });

  it('does not downgrade when autoEligible is within the safe baseline', async () => {
    const yaml = `
templateId: safe-auto
name: Safe Auto
version: 1.0.0
agentType: opencode
runtimeFamily: opencode
lifecycleIntent: durable
capabilityProfile:
  platformPrimitives: [soul.read]
  capabilityBundles: [read-only]
approvalPolicy:
  autoEligible: true
`;
    const { warnings } = await validateTemplate(yaml, CTX);
    expect(codes(warnings)).not.toContain('APPROVAL_POLICY_DOWNGRADED');
  });
});

// ─── T024: Full failure-code matrix via fixture files ────────────────────────
// Each fixture is a YAML file designed to trigger exactly one failure code.
// SC-002: 100% of templates violating a rule are rejected with a named reason.
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = (name: string) =>
  readFileSync(join(__dirname, 'fixtures', name), 'utf8');

describe('Validator - Failure-code matrix (SC-002, T024)', () => {
  it('MISSING_REQUIRED_FIELD — template missing version/agentType/runtimeFamily/lifecycleIntent/capabilityProfile', async () => {
    const { errors } = await validateTemplate(FIXTURE('missing-required-field.yaml'), CTX);
    expect(errors.length).toBeGreaterThan(0);
    expect(codes(errors)).toContain('MISSING_REQUIRED_FIELD');
  });

  it('INVALID_FIELD_TYPE — capabilityProfile.platformPrimitives is a string not an array', async () => {
    const { errors } = await validateTemplate(FIXTURE('invalid-field-type.yaml'), CTX);
    expect(errors.length).toBeGreaterThan(0);
    expect(codes(errors)).toContain('INVALID_FIELD_TYPE');
  });

  it('UNKNOWN_CAPABILITY_BUNDLE — bundle not in context.capabilityBundleAdapters', async () => {
    const { errors } = await validateTemplate(FIXTURE('unknown-capability-bundle.yaml'), CTX);
    expect(codes(errors)).toContain('UNKNOWN_CAPABILITY_BUNDLE');
  });

  it('UNKNOWN_PLATFORM_PRIMITIVE — primitive not in the canonical set', async () => {
    const { errors } = await validateTemplate(FIXTURE('unknown-platform-primitive.yaml'), CTX);
    expect(codes(errors)).toContain('UNKNOWN_PLATFORM_PRIMITIVE');
  });

  it('UNKNOWN_MCP_SERVER — MCP name not in context.mcpServers', async () => {
    const { errors } = await validateTemplate(FIXTURE('unknown-mcp-server.yaml'), CTX);
    expect(codes(errors)).toContain('UNKNOWN_MCP_SERVER');
  });

  it('UNKNOWN_CREDENTIAL — credential name not in context.brokerCredentials', async () => {
    const { errors } = await validateTemplate(FIXTURE('unknown-credential.yaml'), CTX);
    expect(codes(errors)).toContain('UNKNOWN_CREDENTIAL');
  });

  it('LEAST_PRIVILEGE_VIOLATION — mcpAccess references a server not enabled by any declared bundle', async () => {
    const { errors } = await validateTemplate(FIXTURE('least-privilege-violation.yaml'), CTX);
    expect(codes(errors)).toContain('LEAST_PRIVILEGE_VIOLATION');
  });

  it('SECRET_VALUE_PRESENT — sk-style secret in systemPrompt', async () => {
    const { errors } = await validateTemplate(FIXTURE('secret-value-present.yaml'), CTX);
    expect(codes(errors)).toContain('SECRET_VALUE_PRESENT');
  });

  it('APPROVAL_POLICY_DOWNGRADED — autoEligible declared but grants exceed safe baseline (warning, not error)', async () => {
    const { errors, warnings } = await validateTemplate(
      FIXTURE('approval-policy-downgraded.yaml'),
      CTX,
    );
    expect(codes(errors)).not.toContain('APPROVAL_POLICY_DOWNGRADED');
    expect(codes(warnings)).toContain('APPROVAL_POLICY_DOWNGRADED');
    // Template is still valid (not rejected)
    expect(errors.length).toBe(0);
  });

  it('valid template passes all checks with no errors or warnings', async () => {
    const { errors, warnings } = await validateTemplate(FIXTURE('valid-template.yaml'), CTX);
    expect(errors).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });

  it('DUPLICATE_TEMPLATE_ID — same templateId twice in a batch', () => {
    const t = (id: string): CatalogTemplate => ({
      templateId: id, name: id, version: '1.0.0',
      agentType: 'opencode', runtimeFamily: 'opencode', lifecycleIntent: 'ephemeral',
      capabilityProfile: {},
    });
    const errors = checkDuplicateTemplateIds([t('dup'), t('dup')]);
    expect(codes(errors)).toContain('DUPLICATE_TEMPLATE_ID');
    // Does NOT flag distinct ids
    expect(checkDuplicateTemplateIds([t('a'), t('b')])).toHaveLength(0);
  });

  it('VERSION_CONFLICT — same templateId+version appearing twice in a batch', () => {
    const t = (id: string, v: string): CatalogTemplate => ({
      templateId: id, name: id, version: v,
      agentType: 'opencode', runtimeFamily: 'opencode', lifecycleIntent: 'ephemeral',
      capabilityProfile: {},
    });
    const errors = checkDuplicateVersions([t('x', '1.0.0'), t('x', '1.0.0')]);
    expect(codes(errors)).toContain('VERSION_CONFLICT');
    // Different templates sharing a version string is NOT a conflict
    expect(checkDuplicateVersions([t('a', '1.0.0'), t('b', '1.0.0')])).toHaveLength(0);
  });
});
