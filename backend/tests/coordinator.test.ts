import { describe, expect, it } from 'vitest'
import { classifyPrimeRequest } from '../src/coordinator.js'

describe('classifyPrimeRequest', () => {
  it('routes audit requests to operational audit', () => {
    const route = classifyPrimeRequest('Audit open work and stale queues')

    expect(route.capability).toBe('operational-audit')
    expect(route.lane).toBe('operations')
    expect(route.status).toBe('active')
  })

  it('routes implementation requests to implementation', () => {
    const route = classifyPrimeRequest('Implement the Codex app-server adapter')

    expect(route.capability).toBe('implementation')
    expect(route.lane).toBe('implementation')
  })

  it('requires approval for risky requests', () => {
    const route = classifyPrimeRequest('Deploy this to production and restart the service')

    expect(route.capability).toBe('deployment')
    expect(route.requiresApproval).toBe(true)
    expect(route.status).toBe('approval')
    expect(route.priority).toBe('high')
  })

  it('defaults to coordination for ambiguous requests', () => {
    const route = classifyPrimeRequest('What should we do next?')

    expect(route.capability).toBe('coordination')
    expect(route.lane).toBe('intake')
  })
})
