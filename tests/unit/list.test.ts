import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WorkspaceConfig } from '../../src/lib/types.js';

vi.mock('../../src/lib/workspace.js', () => ({
  readConfig: vi.fn(),
}));

import { readConfig } from '../../src/lib/workspace.js';
import { listFeatures, listRepos } from '../../src/lib/list.js';

const mockedReadConfig = vi.mocked(readConfig);

function makeConfig(overrides: Partial<WorkspaceConfig> = {}): WorkspaceConfig {
  return {
    ...{
      version: 1,
      name: 'test-workspace',
      repos: [
        {
          name: 'spwn-shared',
          path: './spwn-shared',
          url: 'https://github.com/spwn-gg/spwn-shared.git',
          defaultBranch: 'main',
          packageName: '@spwn/shared',
          manifestType: 'package.json',
        },
        {
          name: 'spwn-backend',
          path: './spwn-backend',
          url: 'https://github.com/spwn-gg/spwn-backend.git',
          defaultBranch: 'main',
          packageName: 'spwn-backend',
          manifestType: 'package.json',
        },
        {
          name: 'spwn-cli',
          path: './spwn-cli',
          url: 'https://github.com/spwn-gg/spwn-cli.git',
          defaultBranch: 'main',
          packageName: 'spwn-cli',
          manifestType: 'package.json',
        },
        {
          name: 'spwn-frontend',
          path: './spwn-frontend',
          url: 'https://github.com/spwn-gg/spwn-frontend.git',
          defaultBranch: 'main',
          packageName: '@spwn/frontend',
          manifestType: 'package.json',
        },
      ],
      dependencies: [
        { from: 'spwn-backend', to: 'spwn-shared', type: 'runtime', packageName: '@spwn/shared' },
        { from: 'spwn-cli', to: 'spwn-shared', type: 'runtime', packageName: '@spwn/shared' },
        { from: 'spwn-frontend', to: 'spwn-shared', type: 'runtime', packageName: '@spwn/shared' },
      ],
      features: [
        {
          name: 'add-auth',
          createdAt: '2026-03-21T10:00:00.000Z',
          repos: ['spwn-shared', 'spwn-backend'],
        },
        {
          name: 'fix-payments',
          createdAt: '2026-03-21T12:00:00.000Z',
          repos: [],
        },
      ],
      lastUpdated: '2026-03-21T12:00:00.000Z',
    },
    ...overrides,
  };
}

describe('listFeatures', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns all features with name, createdAt, and materialized repo count', async () => {
    mockedReadConfig.mockResolvedValue(makeConfig());

    const result = await listFeatures({ workspaceDir: '/fake/workspace' });

    expect(result).toHaveLength(2);

    expect(result[0]).toEqual({
      name: 'add-auth',
      createdAt: '2026-03-21T10:00:00.000Z',
      materializedRepos: ['spwn-shared', 'spwn-backend'],
      repoCount: 2,
    });

    expect(result[1]).toEqual({
      name: 'fix-payments',
      createdAt: '2026-03-21T12:00:00.000Z',
      materializedRepos: [],
      repoCount: 0,
    });

    expect(mockedReadConfig).toHaveBeenCalledWith('/fake/workspace');
  });

  it('returns empty array when no features exist', async () => {
    mockedReadConfig.mockResolvedValue(makeConfig({ features: [] }));

    const result = await listFeatures({ workspaceDir: '/fake/workspace' });

    expect(result).toEqual([]);
  });
});

describe('listRepos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns all repos with name, path, packageName, and dependency count', async () => {
    mockedReadConfig.mockResolvedValue(makeConfig());

    const result = await listRepos({ workspaceDir: '/fake/workspace' });

    expect(result).toHaveLength(4);

    const shared = result.find((r) => r.name === 'spwn-shared');
    expect(shared).toEqual({
      name: 'spwn-shared',
      path: './spwn-shared',
      packageName: '@spwn/shared',
      defaultBranch: 'main',
      dependsOn: [],
      dependedBy: ['spwn-backend', 'spwn-cli', 'spwn-frontend'],
    });

    const backend = result.find((r) => r.name === 'spwn-backend');
    expect(backend).toEqual({
      name: 'spwn-backend',
      path: './spwn-backend',
      packageName: 'spwn-backend',
      defaultBranch: 'main',
      dependsOn: ['spwn-shared'],
      dependedBy: [],
    });
  });

  it('includes which repos depend on each repo', async () => {
    mockedReadConfig.mockResolvedValue(makeConfig());

    const result = await listRepos({ workspaceDir: '/fake/workspace' });

    const shared = result.find((r) => r.name === 'spwn-shared')!;
    expect(shared.dependedBy).toContain('spwn-backend');
    expect(shared.dependedBy).toContain('spwn-cli');
    expect(shared.dependedBy).toContain('spwn-frontend');
    expect(shared.dependedBy).toHaveLength(3);

    const frontend = result.find((r) => r.name === 'spwn-frontend')!;
    expect(frontend.dependsOn).toEqual(['spwn-shared']);
    expect(frontend.dependedBy).toEqual([]);
  });
});
