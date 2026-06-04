# Contract: Control-Plane LLM/Egress Proxy (FR-008, FR-019, FR-020, FR-021)

The only outbound path from an agent runtime. Provider keys stay server-side.

## LLM proxy

```
POST /internal/llm/{provider}/...     (loopback / unix socket, inside control plane)
Authorization: Bearer <provider_proxy_token>     # broker-issued, scoped, short-lived
```

**Behavior**
- Validate the proxy token against `brokered_credentials` (active, not expired, scope
  permits this provider). Reject otherwise (`401`, emit `egress.denied`).
- Attach the real provider API key server-side; forward to the upstream provider;
  stream the response back. The raw key never leaves the control plane (FR-008).
- Record each brokered call as a `runtime_events` row (`llm.proxied`) for audit (FR-020).

## Egress enforcement

```ts
interface EgressGuard {
  isAllowed(agentId: string, host: string): Promise<boolean>  // default-deny
}
```

**Behavior**
- Default-deny: only hosts in `egress_allowlist` for the agent are permitted (FR-019).
- Enforced at the network boundary the agent cannot bypass (sandbox netns: no DNS, no
  raw outbound TCP; all egress via this proxy) — see `egress-allowlist.md` and R5.
- A blocked attempt emits `egress.denied` with the target host (FR-021 / SC-007).
- Direct-to-provider attempts (bypassing the proxy) are blocked by the same netns,
  leaving the proxy the only working path (spec Edge Case).
