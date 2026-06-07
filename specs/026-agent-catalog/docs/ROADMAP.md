# Agent Catalog Roadmap

## Phase 1: Launcher Path Deployment (COMPLETE)
- [x] Documentation for launcher-based agent isolation
- [x] Docker Compose service wiring
- [x] Backend integration with launcher API

## Phase 2: Foundational (COMPLETE)
- [x] Schema design and migrations
- [x] Types and validation framework
- [x] Admission state machine
- [x] Store CRUD operations
- [x] Router endpoints

## Phase 3: User Stories 1-3 (COMPLETE)
- [x] US1: Import approved template into runtime
- [x] US2: Validator failure modes and rejection handling
- [x] US3: Git source sync, rollback, deprecation

## Phase 4: Polish (COMPLETE)
- [x] Unit tests for validator, store, admission
- [x] Integration tests for full workflows
- [x] API reference documentation
- [x] Operational guide
- [x] Testing guide

## Future Work

### Phase 5: UI/UX
- [ ] Template listing page with filters
- [ ] Admission state visualization
- [ ] Approval queue interface
- [ ] Rejection details view

### Phase 6: Advanced Features
- [ ] Git source sync with webhook triggers
- [ ] Template versioning and branching
- [ ] Template templates (reusable components)
- [ ] Template analytics and usage metrics

### Phase 7: Security & Compliance
- [ ] Template signing and verification
- [ ] Automated security scanning
- [ ] Compliance policy enforcement
- [ ] Audit log export

### Phase 8: Scalability
- [ ] Distributed sync across regions
- [ ] Cache layer for template resolution
- [ ] CDN for template assets
- [ ] Rate limiting and quota management
