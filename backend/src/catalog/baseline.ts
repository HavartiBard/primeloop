// Safe baseline definition for auto-approval
//
// Templates within this baseline can be auto-approved without human review.
// Any template exceeding these bounds requires human approval.

import type { CatalogTemplate } from './types.js';

/**
 * Safe baseline configuration:
 * - Read-only capability bundles (no write/deploy/production primitives)
 * - No credential needs (brokered credentials only via references)
 * - Default-deny egress with empty or trivial allowlist
 */
export const SAFE_BASELINE = {
  // Allowed capability bundles (read-only helpers)
  allowedBundles: ['read-only', 'file-read', 'git-read', 'http-get'],
  
  // Forbidden primitives (write/deploy/production)
  forbiddenPrimitives: [
    'write-file',
    'deploy',
    'production',
    'sudo',
    'root',
    'network-write',
  ],
  
  // Credential needs must be empty (all brokered via references)
  allowCredentialNeeds: false,
  
  // Egress: only empty or localhost allowed
  allowEgressAllowlist: true,
  allowedEgressHosts: ['localhost', '127.0.0.1', '::1'],
};

/**
 * Check if a template is within the safe baseline for auto-approval.
 * Returns true if the template meets all baseline criteria.
 */
export function isWithinBaseline(template: CatalogTemplate): boolean {
  // Check capability bundles - must only contain allowed read-only bundles
  const bundles = template.capabilityProfile?.capabilityBundles || [];
  if (bundles.length === 0) {
    // Empty bundles means no capabilities declared - not within baseline
    return false;
  }
  for (const bundle of bundles) {
    if (!SAFE_BASELINE.allowedBundles.includes(bundle)) {
      return false;
    }
  }
  
  // Check platform primitives - must not contain forbidden ones
  const primitives = template.capabilityProfile?.platformPrimitives || [];
  for (const primitive of primitives) {
    if (SAFE_BASELINE.forbiddenPrimitives.includes(primitive)) {
      return false;
    }
  }
  
  // Check credential needs - must be empty (all brokered)
  if (template.credentialNeeds && template.credentialNeeds.length > 0) {
    return false;
  }
  
  // Check egress - must be empty or only localhost
  const egress = template.runtimeRequirements?.egress;
  if (egress && egress.allowlist) {
    for (const host of egress.allowlist) {
      if (!SAFE_BASELINE.allowedEgressHosts.includes(host)) {
        return false;
      }
    }
  }
  
  return true;
}

/**
 * Get a list of baseline violations for a template.
 * Returns empty array if within baseline.
 */
export function getBaselineViolations(template: CatalogTemplate): string[] {
  const violations: string[] = [];
  
  // Check capability bundles
  const bundles = template.capabilityProfile?.capabilityBundles || [];
  for (const bundle of bundles) {
    if (!SAFE_BASELINE.allowedBundles.includes(bundle)) {
      violations.push(`Bundle '${bundle}' is not in safe baseline`);
    }
  }
  
  // Check platform primitives
  const primitives = template.capabilityProfile?.platformPrimitives || [];
  for (const primitive of primitives) {
    if (SAFE_BASELINE.forbiddenPrimitives.includes(primitive)) {
      violations.push(`Primitive '${primitive}' is forbidden in safe baseline`);
    }
  }
  
  // Check credential needs
  if (template.credentialNeeds && template.credentialNeeds.length > 0) {
    violations.push('Credential needs are not allowed in safe baseline');
  }
  
  // Check egress
  const egress = template.runtimeRequirements?.egress;
  if (egress && egress.allowlist) {
    for (const host of egress.allowlist) {
      if (!SAFE_BASELINE.allowedEgressHosts.includes(host)) {
        violations.push(`Egress host '${host}' is not allowed in safe baseline`);
      }
    }
  }
  
  return violations;
}
