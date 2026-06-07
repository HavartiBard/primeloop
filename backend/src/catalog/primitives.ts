// Canonical platform primitives for catalog validation.
//
// SOURCE OF TRUTH: backend/src/mcp/service.ts `PRIMITIVE_TO_TOOL`, which is the
// authoritative platform-primitive -> control-plane-tool registry consumed by
// listControlPlaneToolsForGrant(). These same primitive names are emitted by the
// default capability profiles in backend/src/durable-staff.ts and
// backend/src/ephemeral-templates.ts (e.g. delegate, update_work_item,
// request_approval, soul.read, memory.read/write, lesson.read/write,
// context.assemble, loop.inspect).
//
// There is no single exported constant in the codebase to import here without
// creating a cross-module coupling between the catalog and the MCP service, so we
// mirror the canonical set in one documented place. If a primitive is added to
// PRIMITIVE_TO_TOOL, add it here too.

/**
 * The canonical set of platform primitive names recognized by PrimeLoop.
 * Mirrors the keys of `PRIMITIVE_TO_TOOL` in backend/src/mcp/service.ts.
 */
export const KNOWN_PLATFORM_PRIMITIVES: ReadonlySet<string> = new Set<string>([
  'delegate',
  'request_peer_review',
  'request_approval',
  'update_work_item',
  'soul.read',
  'soul.write',
  'memory.read',
  'memory.write',
  'lesson.read',
  'lesson.write',
  'context.assemble',
  'loop.inspect',
  'snapshot.create',
  'fleet.learnings',
  'pattern.publish',
  'agent.soul.update',
  'approval.resolve',
]);

/**
 * Returns true if `primitive` is a recognized platform primitive.
 */
export function isKnownPrimitive(primitive: string): boolean {
  return KNOWN_PLATFORM_PRIMITIVES.has(primitive);
}
