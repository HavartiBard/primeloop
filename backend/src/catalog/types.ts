// Catalog core types - Agent configuration management
//
// See catalog/index.ts for module overview.

// Admission state machine states
export type AdmissionState = 
  | 'discovered'
  | 'validated'
  | 'rejected'
  | 'pending_approval'
  | 'registered'
  | 'deprecated'
  | 'active';

// Failure codes for validation errors
export type FailureCode =
  | 'MISSING_REQUIRED_FIELD'
  | 'INVALID_FIELD_TYPE'
  | 'UNKNOWN_RUNTIME_FAMILY'
  | 'UNKNOWN_CAPABILITY_BUNDLE'
  | 'UNKNOWN_PLATFORM_PRIMITIVE'
  | 'UNKNOWN_MCP_SERVER'
  | 'UNKNOWN_CREDENTIAL'
  | 'UNKNOWN_PROVIDER'
  | 'LEAST_PRIVILEGE_VIOLATION'
  | 'DUPLICATE_TEMPLATE_ID'
  | 'VERSION_CONFLICT'
  | 'SECRET_VALUE_PRESENT'
  | 'APPROVAL_POLICY_DOWNGRADED';

// A single failure reason
export interface FailureReason {
  code: FailureCode;
  field?: string;
  detail?: string;
}

// Sync entry result for batch operations
export interface SyncEntryResult {
  templateId: string;
  version: string;
  outcome: 'admitted' | 'rejected' | 'duplicate';
  admissionState?: AdmissionState;
  failureReasons?: FailureReason[];
}

// Catalog source configuration
export interface CatalogSource {
  id: string;
  kind: 'local' | 'git';
  name: string;
  location: string;
  defaultRef?: string;
  subpath?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

// Template definition (from YAML file)
export interface CatalogTemplate {
  templateId: string;
  name: string;
  version: string;
  agentType: string;
  runtimeFamily: string;
  lifecycleIntent: 'durable' | 'ephemeral';
  systemPrompt?: string;
  soul?: string;
  persona?: string;
  systemPromptFile?: string;
  soulFile?: string;
  personaFile?: string;
  capabilityProfile: {
    platformPrimitives?: string[];
    capabilityBundles?: string[];
    denyRules?: string[];
  };
  toolAccess?: string[];
  mcpAccess?: string[];
  credentialNeeds?: string[];
  runtimeRequirements?: {
    limits?: {
      maxTokens?: number;
      maxMemoryMB?: number;
    };
    filesystemScope?: {
      read?: string[];
      write?: string[];
    };
    egress?: {
      allowlist?: string[];
    };
  };
  approvalPolicy?: {
    autoEligible?: boolean;
  };
  routing?: {
    preferredRole?: string;
    workClass?: string;
  };
  provenance?: {
    source?: string;
    version?: string;
    commitSha?: string;
    sourcePath?: string;
    sourceRef?: string;
  };
}

// Fully resolved template definition (with file references resolved)
export interface ResolvedTemplate extends CatalogTemplate {
  systemPrompt: string;
  soul: string;
  persona: string;
}

// Database snapshot of a registered version
export interface CatalogTemplateVersionSnapshot {
  id: string;
  templateId: string;
  version: string;
  admissionState: AdmissionState;
  resolvedDefinition: ResolvedTemplate;
  contentHash: string;
  sourceId?: string;
  commitSha?: string;
  sourcePath?: string;
  sourceRef?: string;
  capabilityProfileId?: string;
  failureReasons: FailureReason[];
  approvalId?: string;
  autoApproved: boolean;
  createdAt: string;
  updatedAt: string;
}

// Admission event for audit trail
export interface AdmissionEvent {
  id: string;
  versionId: string;
  fromState?: AdmissionState;
  toState: AdmissionState;
  actor: 'operator' | 'prime' | 'sync' | 'migrate';
  reason?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Prime Module Types (catalog extension)
// ─────────────────────────────────────────────────────────────────────────────

export const PRIME_MODULE_STAGES = [
  'trigger',
  'debounce',
  'context',
  'decision',
  'policy',
  'action',
  'feedback',
  'learning',
  'observer',
] as const;

export type PrimeModuleStage = typeof PRIME_MODULE_STAGES[number];

export interface PrimeModuleManifest extends Record<string, unknown> {
  stage: PrimeModuleStage;
  order: number;
  requires_active?: boolean;
  available_versions?: string[];
}

export interface PrimeModuleInterface {
  inputs?: Array<{
    name: string;
    type: string;
    description?: string;
  }>;
  outputs?: Array<{
    name: string;
    type: string;
    description?: string;
  }>;
}

export interface PrimeModuleTesting {
  required_tests?: Array<{
    name: string;
    description?: string;
  }>;
}

export interface ModuleDependency {
  templateId: string;
  versionRange: string; // Semver range (e.g., '^1.0.0', '~1.2.3')
}

export interface PrimeModuleTemplate {
  templateId: string;
  version: string;
  description?: string;
  manifest: PrimeModuleManifest;
  interface?: PrimeModuleInterface;
  configuration?: {
    schema: Record<string, unknown>;
  };
  testing?: PrimeModuleTesting;
  dependencies?: ModuleDependency[]; // New: Module version dependencies
  provenance?: {
    author?: string;
    created_at?: string;
    source?: string;
    git_sha?: string | null;
  };
}

// CatalogTemplate extended with optional module manifest
export interface CatalogTemplateWithModule extends CatalogTemplate {
  primeModule?: PrimeModuleTemplate;
}

// ─────────────────────────────────────────────────────────────────────────────
// Semver utilities for version resolution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse a semantic version string into components.
 */
export interface VersionParts {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string;
}

export function parseVersion(version: string): VersionParts | null {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-([a-zA-Z0-9.]+))?$/);
  if (!match) return null;
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
    prerelease: match[4],
  };
}

/**
 * Compare two versions. Returns:
 * - negative if v1 < v2
 * - zero if v1 === v2
 * - positive if v1 > v2
 */
export function compareVersions(v1: VersionParts, v2: VersionParts): number {
  // Compare major
  if (v1.major !== v2.major) return v1.major - v2.major;
  // Compare minor
  if (v1.minor !== v2.minor) return v1.minor - v2.minor;
  // Compare patch
  if (v1.patch !== v2.patch) return v1.patch - v2.patch;
  // Prerelease versions are lower than release versions
  if (v1.prerelease && !v2.prerelease) return -1;
  if (!v1.prerelease && v2.prerelease) return 1;
  if (v1.prerelease && v2.prerelease) {
    // Compare prerelease strings
    if (v1.prerelease < v2.prerelease) return -1;
    if (v1.prerelease > v2.prerelease) return 1;
  }
  return 0;
}

/**
 * Check if a version satisfies a semver range.
 * Supports: ^1.0.0, ~1.0.0, >=1.0.0, <=2.0.0, exact versions, x-ranges
 */
export function satisfiesVersion(version: VersionParts, range: string): boolean {
  // Exact version match
  if (/^\d+\.\d+\.\d+$/.test(range)) {
    const parsed = parseVersion(range);
    return parsed ? compareVersions(version, parsed) === 0 : false;
  }
  
  // Caret range (^1.2.3): allow changes that do not modify major version
  if (range.startsWith('^')) {
    const target = parseVersion(range.slice(1));
    if (!target) return false;
    // Version must be >= target
    if (compareVersions(version, target) < 0) return false;
    // For major > 0, minor changes are breaking (so only same major)
    // For major = 0, patch changes are breaking (so only same major.minor)
    if (target.major > 0) {
      return version.major === target.major;
    } else {
      return version.major === target.major && version.minor === target.minor;
    }
  }
  
  // Tilde range (~1.2.3): allow patch-level changes
  if (range.startsWith('~')) {
    const target = parseVersion(range.slice(1));
    if (!target) return false;
    if (compareVersions(version, target) < 0) return false;
    return version.major === target.major && version.minor === target.minor;
  }
  
  // Comparison operators
  if (range.startsWith('>=')) {
    const target = parseVersion(range.slice(2));
    return target ? compareVersions(version, target) >= 0 : false;
  }
  if (range.startsWith('<=')) {
    const target = parseVersion(range.slice(2));
    return target ? compareVersions(version, target) <= 0 : false;
  }
  if (range.startsWith('>')) {
    const target = parseVersion(range.slice(1));
    return target ? compareVersions(version, target) > 0 : false;
  }
  if (range.startsWith('<')) {
    const target = parseVersion(range.slice(1));
    return target ? compareVersions(version, target) < 0 : false;
  }
  if (range.startsWith('!=')) {
    const target = parseVersion(range.slice(2));
    return target ? compareVersions(version, target) !== 0 : false;
  }
  if (range.startsWith('=')) {
    const target = parseVersion(range.slice(1));
    return target ? compareVersions(version, target) === 0 : false;
  }
  
  // x-ranges
  if (range.includes('x')) {
    const parts = range.split('.');
    if (parts.length !== 3) return false;
    const target: VersionParts = {
      major: parts[0] === 'x' ? version.major : parseInt(parts[0], 10),
      minor: parts[1] === 'x' ? version.minor : parseInt(parts[1], 10),
      patch: parts[2] === 'x' ? version.patch : parseInt(parts[2], 10),
    };
    return compareVersions(version, target) === 0;
  }
  
  // Wildcard versions (1.x, 1)
  if (/^\d+\.x$/.test(range)) {
    const major = parseInt(range[0], 10);
    return version.major === major;
  }
  if (/^\d+$/.test(range)) {
    const major = parseInt(range, 10);
    return version.major === major;
  }
  
  // Range with hyphen (1.0.0 - 2.0.0)
  if (/^\d+\.\d+\.\d+\s*-\s*\d+\.\d+\.\d+$/.test(range)) {
    const [min, max] = range.split('-').map(s => parseVersion(s.trim())!);
    return compareVersions(version, min) >= 0 && compareVersions(version, max) <= 0;
  }
  
  return false;
}

/**
 * Find the highest version that satisfies all dependencies.
 */
export function findHighestSatisfyingVersion(
  versions: VersionParts[],
  dependencies: { templateId: string; versionRange: string }[],
): VersionParts | null {
  // For now, we only support a single dependency per module
  if (dependencies.length === 0) {
    return versions.reduce((max, v) => compareVersions(v, max!) >= 0 ? v : max, versions[0] || null);
  }
  
  const dep = dependencies[0];
  const satisfying = versions.filter(v => satisfiesVersion(v, dep.versionRange));
  if (satisfying.length === 0) return null;
  
  return satisfying.reduce((max, v) => compareVersions(v, max!) >= 0 ? v : max, satisfying[0]);
}

/**
 * Detect circular dependencies in module dependency graph.
 */
export function detectCircularDependencies(
  modules: Map<string, { templateId: string; version: VersionParts; dependencies: ModuleDependency[] }>,
): string[] {
  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  const cycles: string[] = [];
  
  function dfs(templateId: string, path: string[]): boolean {
    if (recursionStack.has(templateId)) {
      const cycleStart = path.indexOf(templateId);
      cycles.push(path.slice(cycleStart).concat(templateId).join(' -> '));
      return true;
    }
    if (visited.has(templateId)) return false;
    
    visited.add(templateId);
    recursionStack.add(templateId);
    path.push(templateId);
    
    const module = modules.get(templateId);
    if (module) {
      for (const dep of module.dependencies) {
        if (dfs(dep.templateId, path)) {
          path.pop();
          recursionStack.delete(templateId);
          return true;
        }
      }
    }
    
    path.pop();
    recursionStack.delete(templateId);
    return false;
  }
  
  for (const [templateId] of modules) {
    if (!visited.has(templateId)) {
      dfs(templateId, []);
    }
  }
  
  return cycles;
}
