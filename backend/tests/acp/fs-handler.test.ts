import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { FsHandler } from '../../src/acp/fs-handler.js';

describe('FsHandler', () => {
  let sandboxRoot: string;
  let handler: FsHandler;

  beforeEach(async () => {
    sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'acp-fs-test-'));
    handler = new FsHandler(sandboxRoot);
  });

  afterEach(async () => {
    await fs.rm(sandboxRoot, { recursive: true, force: true });
  });

  describe('readTextFile', () => {
    it('reads a file within sandbox', async () => {
      const testFile = path.join(sandboxRoot, 'test.txt');
      await fs.writeFile(testFile, 'Hello World');
      
      const result = await handler.readTextFile('test.txt');
      expect(result.content).toBe('Hello World');
    });

    it('rejects path escaping sandbox', async () => {
      await expect(handler.readTextFile('../escape.txt')).rejects.toThrow('Path escapes sandbox');
    });

    it('rejects absolute path outside sandbox', async () => {
      await expect(handler.readTextFile('/etc/passwd')).rejects.toThrow('Path escapes sandbox');
    });

    it('supports line and limit parameters', async () => {
      const testFile = path.join(sandboxRoot, 'lines.txt');
      await fs.writeFile(testFile, 'Line 1\nLine 2\nLine 3\nLine 4');
      
      const result = await handler.readTextFile('lines.txt', 2, 2);
      expect(result.content).toBe('Line 2\nLine 3');
    });
  });

  describe('writeTextFile', () => {
    it('writes a file within sandbox', async () => {
      await handler.writeTextFile('output.txt', 'New content');
      const testFile = path.join(sandboxRoot, 'output.txt');
      const content = await fs.readFile(testFile, 'utf-8');
      expect(content).toBe('New content');
    });

    it('creates directories if they do not exist', async () => {
      await handler.writeTextFile('dir/subdir/output.txt', 'Nested content');
      const testFile = path.join(sandboxRoot, 'dir/subdir/output.txt');
      const content = await fs.readFile(testFile, 'utf-8');
      expect(content).toBe('Nested content');
    });

    it('rejects write path escaping sandbox', async () => {
      await expect(handler.writeTextFile('../escape.txt', 'bad')).rejects.toThrow('Path escapes sandbox');
    });
  });

  describe('symlink confinement', () => {
    it('rejects read through symlink escaping sandbox', async () => {
      const outsideFile = path.join(os.tmpdir(), 'outside.txt');
      await fs.writeFile(outsideFile, 'Secret');
      
      const symlinkPath = path.join(sandboxRoot, 'link.txt');
      await fs.symlink(outsideFile, symlinkPath);

      await expect(handler.readTextFile('link.txt')).rejects.toThrow('Symlink escapes sandbox');
      
      await fs.unlink(outsideFile);
    });
  });
});
