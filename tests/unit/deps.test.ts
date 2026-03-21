import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { RepoConfig, DependencyEdge } from '../../src/lib/types.js';
import {
  detectDependencies,
  topologicalSort,
} from '../../src/lib/deps.js';

/** Helper: create a temporary directory and return its real path. */
function makeTmpDir(): string {
  return fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'spwn-deps-test-')),
  );
}

/** Helper: create a repo directory with a package.json inside a workspace root. */
function createRepoDir(
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
  return dir;
}

/** Helper: build a RepoConfig pointing at a temp directory. */
function makeRepo(
  name: string,
  absPath: string,
  packageName?: string,
): RepoConfig {
  return {
    name,
    path: absPath,
    url: `https://github.com/example/${name}.git`,
    defaultBranch: 'main',
    packageName: packageName ?? `@spwn/${name}`,
    manifestType: 'package.json',
  };
}

describe('detectDependencies', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('detects dependencies from package.json dependencies field when package name matches another repo', () => {
    const dirA = createRepoDir(tmpDir, 'app', {
      name: '@spwn/app',
      dependencies: { '@spwn/lib': '^1.0.0' },
    });
    const dirB = createRepoDir(tmpDir, 'lib', {
      name: '@spwn/lib',
    });

    const repos: RepoConfig[] = [
      makeRepo('app', dirA),
      makeRepo('lib', dirB),
    ];

    const edges = detectDependencies(repos);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      from: 'app',
      to: 'lib',
      type: 'runtime',
      packageName: '@spwn/lib',
    });
  });

  it('detects devDependencies and peerDependencies', () => {
    const dirA = createRepoDir(tmpDir, 'app', {
      name: '@spwn/app',
      devDependencies: { '@spwn/tools': '*' },
      peerDependencies: { '@spwn/shared': '>=1.0.0' },
    });
    const dirTools = createRepoDir(tmpDir, 'tools', {
      name: '@spwn/tools',
    });
    const dirShared = createRepoDir(tmpDir, 'shared', {
      name: '@spwn/shared',
    });

    const repos: RepoConfig[] = [
      makeRepo('app', dirA),
      makeRepo('tools', dirTools),
      makeRepo('shared', dirShared),
    ];

    const edges = detectDependencies(repos);
    expect(edges).toHaveLength(2);

    const devEdge = edges.find((e) => e.packageName === '@spwn/tools');
    expect(devEdge).toMatchObject({
      from: 'app',
      to: 'tools',
      type: 'dev',
    });

    const peerEdge = edges.find((e) => e.packageName === '@spwn/shared');
    expect(peerEdge).toMatchObject({
      from: 'app',
      to: 'shared',
      type: 'peer',
    });
  });

  it('detects file:../ references', () => {
    const dirA = createRepoDir(tmpDir, 'frontend', {
      name: '@spwn/frontend',
      dependencies: { '@spwn/shared': 'file:../shared' },
    });
    const dirB = createRepoDir(tmpDir, 'shared', {
      name: '@spwn/shared',
    });

    const repos: RepoConfig[] = [
      makeRepo('frontend', dirA),
      makeRepo('shared', dirB),
    ];

    const edges = detectDependencies(repos);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      from: 'frontend',
      to: 'shared',
      packageName: '@spwn/shared',
    });
  });

  it('returns empty array when no cross-dependencies exist', () => {
    const dirA = createRepoDir(tmpDir, 'alpha', {
      name: '@spwn/alpha',
      dependencies: { lodash: '^4.0.0' },
    });
    const dirB = createRepoDir(tmpDir, 'beta', {
      name: '@spwn/beta',
      dependencies: { express: '^4.0.0' },
    });

    const repos: RepoConfig[] = [
      makeRepo('alpha', dirA),
      makeRepo('beta', dirB),
    ];

    const edges = detectDependencies(repos);
    expect(edges).toHaveLength(0);
  });

  it('handles repos with no manifest file (skips them)', () => {
    const dirA = createRepoDir(tmpDir, 'app', {
      name: '@spwn/app',
      dependencies: { '@spwn/lib': '^1.0.0' },
    });
    // Create a directory with no package.json
    const dirNoManifest = path.join(tmpDir, 'no-manifest');
    fs.mkdirSync(dirNoManifest, { recursive: true });

    const repos: RepoConfig[] = [
      makeRepo('app', dirA),
      makeRepo('no-manifest', dirNoManifest),
    ];

    // Should not throw, and should return empty since no-manifest
    // has no packageName match in any manifest
    const edges = detectDependencies(repos);
    expect(Array.isArray(edges)).toBe(true);
  });

  it('handles multiple dependency types between same repos', () => {
    const dirA = createRepoDir(tmpDir, 'consumer', {
      name: '@spwn/consumer',
      dependencies: { '@spwn/core': '^1.0.0' },
      devDependencies: { '@spwn/core': '^1.0.0' },
      peerDependencies: { '@spwn/core': '>=1.0.0' },
    });
    const dirB = createRepoDir(tmpDir, 'core', {
      name: '@spwn/core',
    });

    const repos: RepoConfig[] = [
      makeRepo('consumer', dirA),
      makeRepo('core', dirB),
    ];

    const edges = detectDependencies(repos);
    // Should have up to 3 edges (one per dependency type)
    expect(edges.length).toBeGreaterThanOrEqual(1);

    const types = edges.map((e) => e.type);
    // At minimum runtime should be detected
    expect(types).toContain('runtime');
  });
});

describe('topologicalSort', () => {
  /** Shorthand to build a RepoConfig by name only (path doesn't matter for sort). */
  function repo(name: string): RepoConfig {
    return {
      name,
      path: `/fake/${name}`,
      url: `https://github.com/example/${name}.git`,
      defaultBranch: 'main',
      packageName: `@spwn/${name}`,
      manifestType: 'package.json',
    };
  }

  function edge(from: string, to: string): DependencyEdge {
    return {
      from,
      to,
      type: 'runtime',
      packageName: `@spwn/${to}`,
    };
  }

  it('linear chain A->B->C returns leaves first [C, B, A]', () => {
    const repos = [repo('A'), repo('B'), repo('C')];
    const deps = [edge('A', 'B'), edge('B', 'C')];

    const result = topologicalSort(repos, deps);
    expect(result.hasCycle).toBe(false);
    expect(result.cycle).toHaveLength(0);

    const names = result.sorted.map((r) => r.name);
    // C must come before B, B must come before A
    expect(names.indexOf('C')).toBeLessThan(names.indexOf('B'));
    expect(names.indexOf('B')).toBeLessThan(names.indexOf('A'));
  });

  it('diamond graph returns valid topological order', () => {
    // A->B, A->C, B->D, C->D
    const repos = [repo('A'), repo('B'), repo('C'), repo('D')];
    const deps = [
      edge('A', 'B'),
      edge('A', 'C'),
      edge('B', 'D'),
      edge('C', 'D'),
    ];

    const result = topologicalSort(repos, deps);
    expect(result.hasCycle).toBe(false);

    const names = result.sorted.map((r) => r.name);
    // D must come before B and C; B and C must come before A
    expect(names.indexOf('D')).toBeLessThan(names.indexOf('B'));
    expect(names.indexOf('D')).toBeLessThan(names.indexOf('C'));
    expect(names.indexOf('B')).toBeLessThan(names.indexOf('A'));
    expect(names.indexOf('C')).toBeLessThan(names.indexOf('A'));
  });

  it('single node returns [A]', () => {
    const repos = [repo('A')];
    const result = topologicalSort(repos, []);

    expect(result.hasCycle).toBe(false);
    expect(result.sorted).toHaveLength(1);
    expect(result.sorted[0].name).toBe('A');
  });

  it('no edges returns all nodes (any order)', () => {
    const repos = [repo('X'), repo('Y'), repo('Z')];
    const result = topologicalSort(repos, []);

    expect(result.hasCycle).toBe(false);
    expect(result.sorted).toHaveLength(3);

    const names = result.sorted.map((r) => r.name).sort();
    expect(names).toEqual(['X', 'Y', 'Z']);
  });

  it('detects cycle: hasCycle=true, cycle contains the cycling nodes', () => {
    // A->B->C->A
    const repos = [repo('A'), repo('B'), repo('C')];
    const deps = [edge('A', 'B'), edge('B', 'C'), edge('C', 'A')];

    const result = topologicalSort(repos, deps);
    expect(result.hasCycle).toBe(true);
    expect(result.cycle.length).toBeGreaterThan(0);

    // The cycle should contain the nodes involved
    for (const node of result.cycle) {
      expect(['A', 'B', 'C']).toContain(node);
    }
  });

  it('two independent chains sort correctly', () => {
    // Chain 1: P->Q    Chain 2: X->Y->Z
    const repos = [repo('P'), repo('Q'), repo('X'), repo('Y'), repo('Z')];
    const deps = [edge('P', 'Q'), edge('X', 'Y'), edge('Y', 'Z')];

    const result = topologicalSort(repos, deps);
    expect(result.hasCycle).toBe(false);
    expect(result.sorted).toHaveLength(5);

    const names = result.sorted.map((r) => r.name);
    // Within chain 1: Q before P
    expect(names.indexOf('Q')).toBeLessThan(names.indexOf('P'));
    // Within chain 2: Z before Y before X
    expect(names.indexOf('Z')).toBeLessThan(names.indexOf('Y'));
    expect(names.indexOf('Y')).toBeLessThan(names.indexOf('X'));
  });
});
