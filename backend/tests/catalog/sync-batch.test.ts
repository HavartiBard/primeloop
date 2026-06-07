// T025: Batch isolation integration tests for Agent Catalog sync.
//
// Verifies FR-015 (valid entries admit even when others in the same batch fail)
// and FR-007/FR-008 (rejected entries never reach pending_approval and never
// partially import). Also tests the reject→correct→re-validate loop (T030).
//
// Uses a real Postgres test database. Reads fixture files from tests/catalog/fixtures/.

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import pg from 'pg';
import { createPool, runMigrations } from '../../src/db.js';
import { createCatalogStore } from '../../src/catalog/store.js';
import { syncFromLocalSource } from '../../src/catalog/admission.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(__dirname, 'fixtures');

const TEST_DB =
  process.env.TEST_DATABASE_URL ?? 'postgresql://primeloop:primeloop_dev@127.0.0.1:5434/primeloop_test';

describe('Catalog Sync - Batch isolation (T025, FR-015)', () => {
  let pool: pg.Pool;
  let tmpDir: string;
  let sourceId: string;

  beforeAll(async () => {
    pool = createPool(TEST_DB);
    await runMigrations(pool);
    // Create a temp dir to act as the catalog source for each test
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-sync-test-'));
    const store = createCatalogStore(pool);
    sourceId = await store.createSource({
      kind: 'local',
      name: `sync-batch-test-${Date.now()}`,
      location: tmpDir,
      enabled: true,
    });
  });

  afterAll(async () => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    await pool.end();
  });

  beforeEach(async () => {
    // Clear catalog state between tests
    await pool.query('DELETE FROM catalog_admission_events');
    await pool.query('DELETE FROM catalog_template_versions');
    await pool.query('DELETE FROM catalog_templates');
    // Clear temp dir contents
    for (const f of fs.readdirSync(tmpDir)) {
      fs.unlinkSync(path.join(tmpDir, f));
    }
  });

  it('valid entries admit even when another entry in the same batch is rejected (FR-015)', async () => {
    // Place one valid and one broken template in the source dir
    fs.copyFileSync(
      path.join(FIXTURE_DIR, 'valid-template.yaml'),
      path.join(tmpDir, 'valid-template.yaml'),
    );
    fs.copyFileSync(
      path.join(FIXTURE_DIR, 'missing-required-field.yaml'),
      path.join(tmpDir, 'missing-required-field.yaml'),
    );

    const results = await syncFromLocalSource({ pool, sourceId, sourcePath: tmpDir });

    const byTemplate = Object.fromEntries(results.map((r) => [r.templateId, r]));
    expect(byTemplate['valid-researcher']?.outcome).toBe('admitted');
    expect(byTemplate['missing-required']?.outcome).toBe('rejected');
    expect(byTemplate['missing-required']?.failureReasons?.length).toBeGreaterThan(0);
  });

  it('rejected entry never reaches pending_approval (FR-007, FR-008)', async () => {
    fs.copyFileSync(
      path.join(FIXTURE_DIR, 'unknown-capability-bundle.yaml'),
      path.join(tmpDir, 'bad.yaml'),
    );

    const results = await syncFromLocalSource({ pool, sourceId, sourcePath: tmpDir });
    expect(results[0].outcome).toBe('rejected');
    expect(results[0].admissionState).toBe('rejected');

    // Confirm the DB row state is also 'rejected'
    const store = createCatalogStore(pool);
    const tmpl = await store.getTemplateByTemplateId('unknown-bundle');
    expect(tmpl).toBeDefined();
    const versions = await store.listVersions(tmpl!.id);
    expect(versions[0].admissionState).toBe('rejected');
    expect(versions[0].failureReasons.length).toBeGreaterThan(0);
  });

  it('a partially-failing batch returns per-entry outcomes (not a silent abort)', async () => {
    // Three templates: valid, missing-field, unknown-primitive
    fs.copyFileSync(path.join(FIXTURE_DIR, 'valid-template.yaml'), path.join(tmpDir, 'a.yaml'));
    fs.copyFileSync(path.join(FIXTURE_DIR, 'missing-required-field.yaml'), path.join(tmpDir, 'b.yaml'));
    fs.copyFileSync(path.join(FIXTURE_DIR, 'unknown-platform-primitive.yaml'), path.join(tmpDir, 'c.yaml'));

    const results = await syncFromLocalSource({ pool, sourceId, sourcePath: tmpDir });

    expect(results).toHaveLength(3);
    const admitted = results.filter((r) => r.outcome === 'admitted');
    const rejected = results.filter((r) => r.outcome === 'rejected');
    expect(admitted).toHaveLength(1);
    expect(rejected).toHaveLength(2);
    // Each rejected result has a named failure reason
    for (const r of rejected) {
      expect(r.failureReasons?.length).toBeGreaterThan(0);
      expect(r.failureReasons![0].code).toBeTruthy();
    }
  });

  it('reject → correct → re-validate loop: re-syncing a corrected file restarts at discovered and reaches validated (T030)', async () => {
    // 1. Sync a broken template
    fs.copyFileSync(
      path.join(FIXTURE_DIR, 'missing-required-field.yaml'),
      path.join(tmpDir, 'fixable.yaml'),
    );
    const first = await syncFromLocalSource({ pool, sourceId, sourcePath: tmpDir });
    expect(first[0].outcome).toBe('rejected');

    // 2. Replace with a valid template (same templateId would require same file;
    //    here we swap the file contents to simulate correction)
    fs.copyFileSync(
      path.join(FIXTURE_DIR, 'valid-template.yaml'),
      path.join(tmpDir, 'fixable.yaml'),
    );
    const second = await syncFromLocalSource({ pool, sourceId, sourcePath: tmpDir });

    // The corrected template should admit (discovered→validated) on re-sync
    // (valid-researcher is the templateId in valid-template.yaml)
    const result = second.find((r) => r.templateId === 'valid-researcher');
    expect(result?.outcome).toBe('admitted');
    expect(result?.admissionState).toBe('validated');
  });

  it('APPROVAL_POLICY_DOWNGRADED is a warning — template still validates, not rejected (FR-021a)', async () => {
    fs.copyFileSync(
      path.join(FIXTURE_DIR, 'approval-policy-downgraded.yaml'),
      path.join(tmpDir, 'downgraded.yaml'),
    );

    const results = await syncFromLocalSource({ pool, sourceId, sourcePath: tmpDir });
    const result = results[0];

    // Should admit (not reject) — downgrade is a warning, not an error
    expect(result.outcome).toBe('admitted');
    expect(result.admissionState).toBe('validated');
  });
});
