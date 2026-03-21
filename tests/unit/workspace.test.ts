import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { init, configExists } from '../../src/lib/workspace.js';

/** Helper: create a temporary directory and return its real path. */
function makeTmpDir(): string {
  return fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'spwn-ws-test-')),
  );
}

/** Helper: run a git command inside a directory. */
function git(repoPath: string, args: string): string {
  return execSync(`git ${args}`, {
    cwd: repoPath,
    encoding: 'utf-8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@test.com',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@test.com',
    },
  }).trim();
}

/** Helper: create a git repo with package.json inside a workspace root. */
function createGitRepo(
  root: string,
  name: string,
  packageJson: Record<string, unknown>,
): string {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify(packageJson, null, 2),
  );
  git(dir, 'init -b main');
  git(dir, 'config user.email "test@test.com"');
  git(dir, 'config user.name "Test"');
  git(dir, 'add .');
  git(dir, 'commit -m "initial commit"');
  return dir;
}

describe('workspace init', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('scans immediate children, detects git repos, creates .spwn/workspace.json', async () => {
    createGitRepo(tmpDir, 'repo-a', {
      name: '@spwn/repo-a',
      version: '1.0.0',
    });
    createGitRepo(tmpDir, 'repo-b', {
      name: '@spwn/repo-b',
      version: '1.0.0',
    });

    const config = await init({ dir: tmpDir, name: 'test-workspace' });

    expect(config.repos).toHaveLength(2);
    const repoNames = config.repos.map((r) => r.name).sort();
    expect(repoNames).toEqual(['repo-a', 'repo-b']);

    // Config file should have been persisted
    expect(configExists(tmpDir)).toBe(true);

    // Verify the file on disk
    const configPath = path.join(tmpDir, '.spwn', 'workspace.json');
    expect(fs.existsSync(configPath)).toBe(true);
    const written = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(written.name).toBe('test-workspace');
  });

  it('detects cross-repo dependencies from package.json', async () => {
    createGitRepo(tmpDir, 'frontend', {
      name: '@spwn/frontend',
      version: '1.0.0',
      dependencies: { '@spwn/shared': '^1.0.0' },
    });
    createGitRepo(tmpDir, 'shared', {
      name: '@spwn/shared',
      version: '1.0.0',
    });

    const config = await init({ dir: tmpDir, name: 'dep-workspace' });

    expect(config.dependencies).toHaveLength(1);
    expect(config.dependencies[0]).toMatchObject({
      from: 'frontend',
      to: 'shared',
      packageName: '@spwn/shared',
    });
  });

  it('rejects circular dependencies with error listing the cycle', async () => {
    createGitRepo(tmpDir, 'alpha', {
      name: '@spwn/alpha',
      version: '1.0.0',
      dependencies: { '@spwn/beta': '^1.0.0' },
    });
    createGitRepo(tmpDir, 'beta', {
      name: '@spwn/beta',
      version: '1.0.0',
      dependencies: { '@spwn/alpha': '^1.0.0' },
    });

    await expect(
      init({ dir: tmpDir, name: 'cyclic-workspace' }),
    ).rejects.toThrow(/cycle|circular/i);
  });

  it('errors when no git repos found in directory', async () => {
    // Create a plain directory (no git repos inside)
    fs.mkdirSync(path.join(tmpDir, 'not-a-repo'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'not-a-repo', 'file.txt'),
      'hello',
    );

    await expect(
      init({ dir: tmpDir, name: 'empty-workspace' }),
    ).rejects.toThrow(/no.*repo|no.*git/i);
  });

  it('errors when config already exists', async () => {
    createGitRepo(tmpDir, 'repo-a', {
      name: '@spwn/repo-a',
      version: '1.0.0',
    });

    // Create an existing config
    const configDir = path.join(tmpDir, '.spwn');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      path.join(configDir, 'workspace.json'),
      JSON.stringify({ version: 1, name: 'existing' }),
    );

    expect(configExists(tmpDir)).toBe(true);

    await expect(
      init({ dir: tmpDir, name: 'duplicate-workspace' }),
    ).rejects.toThrow(/already exists|config.*exists/i);
  });

  it('creates correct WorkspaceConfig shape with relative paths', async () => {
    createGitRepo(tmpDir, 'svc', {
      name: '@spwn/svc',
      version: '1.0.0',
    });

    const config = await init({ dir: tmpDir, name: 'shape-test' });

    expect(config.version).toBe(1);
    expect(config.name).toBe('shape-test');
    expect(Array.isArray(config.repos)).toBe(true);
    expect(Array.isArray(config.dependencies)).toBe(true);
    expect(Array.isArray(config.features)).toBe(true);
    expect(config.features).toHaveLength(0);
    expect(typeof config.lastUpdated).toBe('string');
    // Verify ISO 8601 date
    expect(new Date(config.lastUpdated).toISOString()).toBe(config.lastUpdated);

    // Paths should be relative, not absolute
    for (const repo of config.repos) {
      expect(path.isAbsolute(repo.path)).toBe(false);
      expect(repo.path).toBe('./svc');
    }
  });

  it('only scans one level deep (does not recurse into subdirectories of repos)', async () => {
    const repoDir = createGitRepo(tmpDir, 'outer', {
      name: '@spwn/outer',
      version: '1.0.0',
    });

    // Create a nested git repo inside outer (should be ignored)
    const nestedDir = path.join(repoDir, 'nested-repo');
    fs.mkdirSync(nestedDir, { recursive: true });
    fs.writeFileSync(
      path.join(nestedDir, 'package.json'),
      JSON.stringify({ name: '@spwn/nested', version: '1.0.0' }),
    );
    git(nestedDir, 'init -b main');
    git(nestedDir, 'config user.email "test@test.com"');
    git(nestedDir, 'config user.name "Test"');
    git(nestedDir, 'add .');
    git(nestedDir, 'commit -m "initial commit"');

    const config = await init({ dir: tmpDir, name: 'depth-test' });

    // Should only find "outer", not "nested-repo"
    expect(config.repos).toHaveLength(1);
    expect(config.repos[0].name).toBe('outer');
  });
});
