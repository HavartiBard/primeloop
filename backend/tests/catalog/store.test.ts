// Store tests for Agent Catalog
//
// Backed by a real Postgres test database (TEST_DATABASE_URL). Schema is
// initialized via runMigrations, mirroring the other DB-backed suites.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import pg from 'pg';
import { createPool, runMigrations } from '../../src/db.js';
import { createCatalogStore } from '../../src/catalog/store.js';

const TEST_DB =
  process.env.TEST_DATABASE_URL ?? 'postgresql://primeloop:primeloop_dev@127.0.0.1:5434/primeloop_test';

describe('Catalog Store', () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = createPool(TEST_DB);
    await runMigrations(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    // Clean catalog state between tests (events/versions cascade from templates).
    await pool.query('DELETE FROM catalog_admission_events');
    await pool.query('DELETE FROM catalog_template_versions');
    await pool.query('DELETE FROM catalog_templates');
    await pool.query("DELETE FROM catalog_sources WHERE name <> 'default-local'");
  });

  it('creates and retrieves source', async () => {
    const store = createCatalogStore(pool);

    const id = await store.createSource({
      kind: 'local',
      name: 'test-source',
      location: '/tmp/catalog',
      enabled: true,
    });

    expect(id).toBeDefined();

    const source = await store.getSourceById(id);
    expect(source).toBeDefined();
    expect(source?.name).toBe('test-source');
    expect(source?.kind).toBe('local');
  });

  it('creates and retrieves template', async () => {
    const store = createCatalogStore(pool);

    const id = await store.createTemplate('template-1', 'Test Template');
    expect(id).toBeDefined();

    const template = await store.getTemplateByTemplateId('template-1');
    expect(template).toBeDefined();
    expect(template?.name).toBe('Test Template');
    expect(template?.templateId).toBe('template-1');
    expect(template?.lifecycleState).toBe('available');
  });

  it('creates and retrieves version', async () => {
    const store = createCatalogStore(pool);

    const templatePk = await store.createTemplate('template-1', 'Test Template');
    expect(templatePk).toBeDefined();

    const versionPk = await store.createVersion({
      templatePk,
      version: '1.0.0',
      admissionState: 'discovered',
      resolvedDefinition: { templateId: 'template-1' } as any,
      contentHash: 'abc123',
      sourceId: undefined,
      failureReasons: [],
      autoApproved: false,
    });

    expect(versionPk).toBeDefined();

    const version = await store.getVersionById(versionPk);
    expect(version).toBeDefined();
    expect(version?.version).toBe('1.0.0');
    expect(version?.admissionState).toBe('discovered');
  });

  it('records and retrieves admission events', async () => {
    const store = createCatalogStore(pool);

    const templatePk = await store.createTemplate('template-1', 'Test Template');
    const versionPk = await store.createVersion({
      templatePk,
      version: '1.0.0',
      admissionState: 'discovered',
      resolvedDefinition: { templateId: 'template-1' } as any,
      contentHash: 'abc123',
      sourceId: undefined,
      failureReasons: [],
      autoApproved: false,
    });

    const eventId = await store.recordAdmissionEvent({
      versionId: versionPk,
      fromState: 'discovered',
      toState: 'validated',
      actor: 'sync',
      reason: 'Auto-validated',
    });

    expect(eventId).toBeDefined();

    const events = await store.getAdmissionEvents(versionPk);
    expect(events).toHaveLength(1);
    expect(events[0].actor).toBe('sync');
    expect(events[0].toState).toBe('validated');
  });

  it('lists versions for template', async () => {
    const store = createCatalogStore(pool);

    const templatePk = await store.createTemplate('template-1', 'Test Template');

    await store.createVersion({
      templatePk,
      version: '1.0.0',
      admissionState: 'discovered',
      resolvedDefinition: { templateId: 'template-1' } as any,
      contentHash: 'abc123',
      sourceId: undefined,
      failureReasons: [],
      autoApproved: false,
    });

    await store.createVersion({
      templatePk,
      version: '1.0.1',
      admissionState: 'discovered',
      resolvedDefinition: { templateId: 'template-1' } as any,
      contentHash: 'def456',
      sourceId: undefined,
      failureReasons: [],
      autoApproved: false,
    });

    // listVersions filters by template_pk (the catalog_templates.id UUID).
    const versions = await store.listVersions(templatePk);
    expect(versions).toHaveLength(2);
  });

  it('freezes a registered version and reports it as frozen', async () => {
    const store = createCatalogStore(pool);

    const templatePk = await store.createTemplate('template-1', 'Test Template');
    const versionPk = await store.createVersion({
      templatePk,
      version: '1.0.0',
      admissionState: 'registered',
      resolvedDefinition: { templateId: 'template-1' } as any,
      contentHash: 'abc123',
      sourceId: undefined,
      failureReasons: [],
      autoApproved: false,
    });

    expect(await store.isVersionFrozen(versionPk)).toBe(true);

    const latest = await store.getLatestRegisteredVersion(templatePk);
    expect(latest?.id).toBe(versionPk);
  });
});
