// Structural YAML schema validation
//
// Defines required/optional fields and validates YAML structure.
// Emits MISSING_REQUIRED_FIELD / INVALID_FIELD_TYPE codes.

import * as yaml from 'yaml';

import type { CatalogTemplate, FailureReason } from './types.js';

// Required fields for a valid template
export const REQUIRED_FIELDS = [
  'templateId',
  'name',
  'version',
  'agentType',
  'runtimeFamily',
  'lifecycleIntent',
  'capabilityProfile',
];

// Optional fields with their expected types
const OPTIONAL_FIELDS: Record<string, string> = {
  systemPrompt: 'string',
  soul: 'string',
  persona: 'string',
  systemPromptFile: 'string',
  soulFile: 'string',
  personaFile: 'string',
  toolAccess: 'array',
  mcpAccess: 'array',
  credentialNeeds: 'array',
  runtimeRequirements: 'object',
  approvalPolicy: 'object',
  routing: 'object',
  primeModule: 'object', // New: Module template definition
};

// Nested field types
const FIELD_TYPES: Record<string, Record<string, string>> = {
  capabilityProfile: {
    platformPrimitives: 'array',
    capabilityBundles: 'array',
    denyRules: 'array',
  },
  runtimeRequirements: {
    limits: 'object',
    filesystemScope: 'object',
    egress: 'object',
  },
  approvalPolicy: {
    autoEligible: 'boolean',
  },
  routing: {
    preferredRole: 'string',
    workClass: 'string',
  },
  primeModule: {
    templateId: 'string',
    version: 'string',
    description: 'string',
    manifest: 'object',
    interface: 'object',
    configuration: 'object',
    testing: 'object',
    dependencies: 'array', // New: Module dependencies
  },
  primeModule_manifest: {
    stage: 'string',
    order: 'number',
    requires_active: 'boolean',
    available_versions: 'array',
  },
  primeModule_interface: {
    inputs: 'array',
    outputs: 'array',
  },
  primeModule_testing: {
    required_tests: 'array',
  },
};

/**
 * Parse YAML content and validate its structure.
 * Returns { template, errors } where errors contains failure reasons.
 */
export function parseTemplateYaml(yamlContent: string): {
  template?: CatalogTemplate;
  errors: FailureReason[];
} {
  const errors: FailureReason[] = [];
  
  // Parse YAML
  let parsed: unknown;
  try {
    parsed = yaml.parse(yamlContent);
  } catch (err) {
    return {
      errors: [{ code: 'INVALID_FIELD_TYPE', detail: `YAML parse error: ${(err as Error).message}` }],
    };
  }
  
  // Must be an object
  if (!isRecord(parsed)) {
    return {
      errors: [{ code: 'INVALID_FIELD_TYPE', detail: 'Root must be a YAML object' }],
    };
  }
  
  // Check required fields
  for (const field of REQUIRED_FIELDS) {
    if (!(field in parsed)) {
      errors.push({ code: 'MISSING_REQUIRED_FIELD', field });
    } else if (!isValidType(parsed[field], OPTIONAL_FIELDS[field] || FIELD_TYPES[field] ? 'object' : 'any')) {
      errors.push({ code: 'INVALID_FIELD_TYPE', field });
    }
  }
  
  // Check optional fields
  for (const [field, expectedType] of Object.entries(OPTIONAL_FIELDS)) {
    if (field in parsed) {
      if (!isValidType(parsed[field], expectedType)) {
        errors.push({ code: 'INVALID_FIELD_TYPE', field });
      }
    }
  }
  
  // Check nested fields
  if ('capabilityProfile' in parsed && isRecord(parsed.capabilityProfile)) {
    for (const [field, expectedType] of Object.entries(FIELD_TYPES.capabilityProfile)) {
      if (field in parsed.capabilityProfile) {
        if (!isValidType(parsed.capabilityProfile[field], expectedType)) {
          errors.push({ code: 'INVALID_FIELD_TYPE', field: `capabilityProfile.${field}` });
        }
      }
    }
  }
  
  // Check runtimeRequirements
  if ('runtimeRequirements' in parsed && isRecord(parsed.runtimeRequirements)) {
    for (const [field, expectedType] of Object.entries(FIELD_TYPES.runtimeRequirements)) {
      if (field in parsed.runtimeRequirements) {
        if (!isValidType(parsed.runtimeRequirements[field], expectedType)) {
          errors.push({ code: 'INVALID_FIELD_TYPE', field: `runtimeRequirements.${field}` });
        }
      }
    }
  }
  
  // Check approvalPolicy
  if ('approvalPolicy' in parsed && isRecord(parsed.approvalPolicy)) {
    for (const [field, expectedType] of Object.entries(FIELD_TYPES.approvalPolicy)) {
      if (field in parsed.approvalPolicy) {
        if (!isValidType(parsed.approvalPolicy[field], expectedType)) {
          errors.push({ code: 'INVALID_FIELD_TYPE', field: `approvalPolicy.${field}` });
        }
      }
    }
  }
  
  // Check routing
  if ('routing' in parsed && isRecord(parsed.routing)) {
    for (const [field, expectedType] of Object.entries(FIELD_TYPES.routing)) {
      if (field in parsed.routing) {
        if (!isValidType(parsed.routing[field], expectedType)) {
          errors.push({ code: 'INVALID_FIELD_TYPE', field: `routing.${field}` });
        }
      }
    }
  }
  
  // Check primeModule
  if ('primeModule' in parsed && isRecord(parsed.primeModule)) {
    for (const [field, expectedType] of Object.entries(FIELD_TYPES.primeModule)) {
      if (field in parsed.primeModule) {
        if (!isValidType(parsed.primeModule[field], expectedType)) {
          errors.push({ code: 'INVALID_FIELD_TYPE', field: `primeModule.${field}` });
        }
      }
    }
    
    // Validate primeModule.manifest
    if (isRecord(parsed.primeModule.manifest)) {
      for (const [field, expectedType] of Object.entries(FIELD_TYPES.primeModule_manifest)) {
        if (field in parsed.primeModule.manifest) {
          if (!isValidType(parsed.primeModule.manifest[field], expectedType)) {
            errors.push({ code: 'INVALID_FIELD_TYPE', field: `primeModule.manifest.${field}` });
          }
        }
      }
    }
    
    // Validate primeModule.interface
    if (isRecord(parsed.primeModule.interface)) {
      for (const [field, expectedType] of Object.entries(FIELD_TYPES.primeModule_interface)) {
        if (field in parsed.primeModule.interface) {
          if (!isValidType(parsed.primeModule.interface[field], expectedType)) {
            errors.push({ code: 'INVALID_FIELD_TYPE', field: `primeModule.interface.${field}` });
          }
        }
      }
    }
    
    // Validate primeModule.testing
    if (isRecord(parsed.primeModule.testing)) {
      for (const [field, expectedType] of Object.entries(FIELD_TYPES.primeModule_testing)) {
        if (field in parsed.primeModule.testing) {
          if (!isValidType(parsed.primeModule.testing[field], expectedType)) {
            errors.push({ code: 'INVALID_FIELD_TYPE', field: `primeModule.testing.${field}` });
          }
        }
      }
    }
  }
  
  if (errors.length > 0) {
    return { errors };
  }
  
  return { template: parsed as unknown as CatalogTemplate, errors: [] };
}

/**
 * Check if value is a plain object (record).
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Check if value matches expected type.
 */
function isValidType(value: unknown, expectedType: string): boolean {
  switch (expectedType) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number';
    case 'boolean':
      return typeof value === 'boolean';
    case 'array':
      return Array.isArray(value);
    case 'object':
      return isRecord(value);
    case 'any':
      return true;
    default:
      return false;
  }
}

/**
 * Parse a module dependency string (e.g., "context.fleet-state@^1.0.0")
 * Returns { templateId, versionRange } or null if invalid.
 */
export function parseModuleDependency(dep: string): { templateId: string; versionRange: string } | null {
  const match = dep.match(/^([a-zA-Z0-9._-]+)@(.+)$/);
  if (!match) return null;
  return { templateId: match[1], versionRange: match[2] };
}

/**
 * Validate a semver version range string.
 * Supports: ^1.0.0 (caret), ~1.0.0 (tilde), >=1.0.0, <=2.0.0, 1.0.0 (exact)
 */
export function isValidVersionRange(range: string): boolean {
  // Exact version
  if (/^\d+\.\d+\.\d+$/.test(range)) return true;
  
  // Caret range (^1.2.3)
  if (/^\^\d+\.\d+\.\d+$/.test(range)) return true;
  
  // Tilde range (~1.2.3)
  if (/^~\d+\.\d+\.\d+$/.test(range)) return true;
  
  // Comparison operators
  if (/^(>=|<=|>|<|!=|=)\d+\.\d+\.\d+$/.test(range)) return true;
  
  // Range with hyphen (1.0.0 - 2.0.0)
  if (/^\d+\.\d+\.\d+\s*-\s*\d+\.\d+\.\d+$/.test(range)) return true;
  
  // Wildcard versions
  if (/^(\d+|x)\.(\d+|x)\.(\d+|x)$/.test(range)) return true;
  if (/^\d+\.x$/.test(range)) return true;
  if (/^\d+$/.test(range)) return true;
  
  return false;
}

/**
 * Parse module dependencies from YAML array.
 */
export function parseModuleDependencies(
  deps: unknown,
): { templateId: string; versionRange: string }[] {
  if (!Array.isArray(deps)) return [];
  
  const result: { templateId: string; versionRange: string }[] = [];
  for (const dep of deps) {
    if (typeof dep === 'string') {
      const parsed = parseModuleDependency(dep);
      if (parsed && isValidVersionRange(parsed.versionRange)) {
        result.push(parsed);
      }
    }
  }
  return result;
}
