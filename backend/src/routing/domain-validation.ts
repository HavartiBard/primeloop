import type pg from 'pg'
import type { Domain } from '../goals/types.js'

const DOMAIN_ROLE_ALLOWLIST: Record<Domain, string[]> = {
  homelab: ['SRE/DevOps', 'sre_devops', 'sre', 'devops', 'prime'],
  development: ['Architect', 'architect', 'prime'],
  personal_assistant: ['personal_assistant', 'assistant', 'prime'],
  cross_domain: ['prime', 'SRE/DevOps', 'Architect', 'personal_assistant'],
}

export function isRoleAllowedForDomain(domain: Domain, assignedAgentRole: string): boolean {
  const normalized = assignedAgentRole.trim().toLowerCase()
  return DOMAIN_ROLE_ALLOWLIST[domain].some((role) => role.toLowerCase() === normalized)
}

/**
 * Validate Prime delegation assignment against domain constraints and active agent_roles capability data.
 */
export async function validateDomainRoleAssignment(
  pool: pg.Pool,
  domain: Domain,
  assignedAgentRole: string,
): Promise<boolean> {
  if (!isRoleAllowedForDomain(domain, assignedAgentRole)) {
    return false
  }

  const { rows } = await pool.query<{ domain_capabilities: string[] }>(
    `SELECT domain_capabilities
     FROM agent_roles
     WHERE (id = $1 OR name = $1)
       AND status = 'active'
     LIMIT 1`,
    [assignedAgentRole],
  )

  const capabilities = rows[0]?.domain_capabilities
  if (!Array.isArray(capabilities) || capabilities.length === 0) {
    return true
  }

  return capabilities.includes(domain) || capabilities.includes('cross_domain')
}

export async function assertDomainRoleAssignment(
  pool: pg.Pool,
  domain: Domain,
  assignedAgentRole: string,
): Promise<void> {
  const valid = await validateDomainRoleAssignment(pool, domain, assignedAgentRole)
  if (!valid) {
    throw new Error(`assigned_agent_role "${assignedAgentRole}" is not executable for domain "${domain}"`)
  }
}
