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
