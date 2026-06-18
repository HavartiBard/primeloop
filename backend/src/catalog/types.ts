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

export interface PrimeModuleManifest {
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
