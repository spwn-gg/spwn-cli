import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GitHubAdapter } from '../../src/lib/github.js';
import type { MergeHistory } from '../../src/lib/types.js';

// Mock modules
vi.mock('../../src/lib/history.js', () => ({
  readHistory: vi.fn(),
}));

vi.mock('../../src/lib/github.js', () => ({
  createGitHubAdapter: vi.fn(),
  parseRepoUrl: vi.fn((url: string) => {
    const match = url.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
    return match ? { owner: match[1], repo: match[2] } : { owner: 'test', repo: 'repo' };
  }),
}));

import { revert } from '../../src/lib/revert.js';
import { readHistory } from '../../src/lib/history.js';
import { createGitHubAdapter } from '../../src/lib/github.js';

const mockReadHistory = vi.mocked(readHistory);
const mockCreateAdapter = vi.mocked(createGitHubAdapter);

function makeHistory(featureName: string): MergeHistory {
  return {
    version: 1,
    entries: [
      {
        featureName,
        mergedAt: '2026-03-21T10:00:00Z',
        method: 'merge',
        steps: [
          {
            repoName: 'shared-lib',
            repoUrl: 'git@github.com:org/shared-lib.git',
            prNumber: 10,
            prUrl: 'https://github.com/org/shared-lib/pull/10',
            mergeSha: 'sha-shared',
          },
          {
            repoName: 'backend',
            repoUrl: 'git@github.com:org/backend.git',
            prNumber: 20,
            prUrl: 'https://github.com/org/backend/pull/20',
            mergeSha: 'sha-backend',
          },
        ],
      },
    ],
  };
}

describe('revert', () => {
  let mockAdapter: {
    createPR: ReturnType<typeof vi.fn>;
    getPRStatus: ReturnType<typeof vi.fn>;
    mergePR: ReturnType<typeof vi.fn>;
    getCommitsAhead: ReturnType<typeof vi.fn>;
    findPR: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockAdapter = {
      createPR: vi.fn(),
      getPRStatus: vi.fn(),
      mergePR: vi.fn(),
      getCommitsAhead: vi.fn(),
      findPR: vi.fn(),
    };
    mockCreateAdapter.mockReturnValue(mockAdapter as unknown as GitHubAdapter);
  });

  it('creates revert PRs in reverse dependency order', async () => {
    mockReadHistory.mockReturnValue(makeHistory('feat-1'));

    mockAdapter.createPR.mockImplementation(async ({ repo }: { repo: string }) => {
      return { url: `https://github.com/org/${repo}/pull/100`, number: 100 };
    });

    const result = await revert({
      workspaceDir: '/test',
      featureName: 'feat-1',
      githubToken: 'fake-token',
    });

    expect(result.allReverted).toBe(true);
    expect(result.steps).toHaveLength(2);
    // Reverse order: backend first, then shared-lib
    expect(result.steps[0].repoName).toBe('backend');
    expect(result.steps[1].repoName).toBe('shared-lib');
  });

  it('dry-run shows plan without creating PRs', async () => {
    mockReadHistory.mockReturnValue(makeHistory('feat-1'));

    const result = await revert({
      workspaceDir: '/test',
      featureName: 'feat-1',
      githubToken: 'fake-token',
      dryRun: true,
    });

    expect(result.steps).toHaveLength(2);
    expect(result.steps.every((s) => s.status === 'skipped')).toBe(true);
    expect(mockAdapter.createPR).not.toHaveBeenCalled();
  });

  it('throws when feature not found in history', async () => {
    mockReadHistory.mockReturnValue({ version: 1, entries: [] });

    await expect(
      revert({
        workspaceDir: '/test',
        featureName: 'nonexistent',
        githubToken: 'fake-token',
      }),
    ).rejects.toThrow(/no merge history found/i);
  });

  it('includes merge SHA in revert PR body', async () => {
    mockReadHistory.mockReturnValue(makeHistory('feat-1'));
    mockAdapter.createPR.mockResolvedValue({ url: 'https://example.com/pr/1', number: 1 });

    await revert({
      workspaceDir: '/test',
      featureName: 'feat-1',
      githubToken: 'fake-token',
    });

    const firstCall = mockAdapter.createPR.mock.calls[0][0];
    expect(firstCall.body).toContain('sha-backend');
    expect(firstCall.title).toContain('Revert');
  });

  it('handles partial failure gracefully', async () => {
    mockReadHistory.mockReturnValue(makeHistory('feat-1'));

    mockAdapter.createPR
      .mockRejectedValueOnce(new Error('API error'))
      .mockResolvedValueOnce({ url: 'https://example.com/pr/2', number: 2 });

    const result = await revert({
      workspaceDir: '/test',
      featureName: 'feat-1',
      githubToken: 'fake-token',
    });

    expect(result.allReverted).toBe(false);
    expect(result.steps[0].status).toBe('failed');
    expect(result.steps[0].error).toContain('API error');
    expect(result.steps[1].status).toBe('reverted');
  });
});
