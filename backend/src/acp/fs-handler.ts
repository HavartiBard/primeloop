import * as fs from 'fs/promises';
import * as path from 'path';

export class FsHandler {
  constructor(private sandboxRoot: string) {
    // Ensure sandbox root is absolute
    this.sandboxRoot = path.resolve(sandboxRoot);
  }

  private resolveAndValidatePath(requestedPath: string): string {
    const resolved = path.resolve(this.sandboxRoot, requestedPath);
    
    // Check if the resolved path is within the sandbox root
    if (!resolved.startsWith(this.sandboxRoot + path.sep) && resolved !== this.sandboxRoot) {
      throw new Error(`Path escapes sandbox: ${requestedPath}`);
    }

    // Symlink resolution check: resolve symlinks and verify the real path is also in sandbox
    // We do this for reads to prevent symlink escapes
    return resolved;
  }

  private async getRealPath(resolvedPath: string): Promise<string> {
    try {
      const real = await fs.realpath(resolvedPath);
      if (!real.startsWith(this.sandboxRoot + path.sep) && real !== this.sandboxRoot) {
        throw new Error(`Symlink escapes sandbox: ${resolvedPath} -> ${real}`);
      }
      return real;
    } catch (err: any) {
      // If file doesn't exist, realpath fails. That's fine for writes or new files.
      // For reads, we'll let the subsequent readFile throw.
      if (err.code === 'ENOENT') {
        return resolvedPath;
      }
      throw err;
    }
  }

  public async readTextFile(requestedPath: string, line?: number, limit?: number): Promise<{ content: string }> {
    const resolved = this.resolveAndValidatePath(requestedPath);
    const realPath = await this.getRealPath(resolved);

    let content = await fs.readFile(realPath, 'utf-8');
    
    if (line !== undefined || limit !== undefined) {
      const lines = content.split('\n');
      const start = line !== undefined ? Math.max(0, line - 1) : 0;
      const end = limit !== undefined ? start + limit : lines.length;
      content = lines.slice(start, end).join('\n');
    }

    return { content };
  }

  public async writeTextFile(requestedPath: string, content: string): Promise<void> {
    const resolved = this.resolveAndValidatePath(requestedPath);
    
    // For writes, we should also ensure the directory exists and is within sandbox
    const dir = path.dirname(resolved);
    await fs.mkdir(dir, { recursive: true });
    
    // Validate the directory realpath as well to prevent symlink directory escapes
    const realDir = await this.getRealPath(dir);
    if (!realDir.startsWith(this.sandboxRoot + path.sep) && realDir !== this.sandboxRoot) {
      throw new Error(`Directory symlink escapes sandbox: ${dir} -> ${realDir}`);
    }

    await fs.writeFile(resolved, content, 'utf-8');
  }
}
