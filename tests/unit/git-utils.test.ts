import { describe, it, expect, vi, beforeEach } from 'vitest';
import { findGitRepos, getMergeBase, getDiff } from '../../src/utils/git.js';

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    readdirSync: vi.fn(),
    statSync: vi.fn(),
    existsSync: vi.fn(),
  };
});

import { execSync } from 'child_process';
import { readdirSync, statSync, existsSync } from 'fs';

const mockExecSync = vi.mocked(execSync);
const mockReaddirSync = vi.mocked(readdirSync);
const mockStatSync = vi.mocked(statSync);
const mockExistsSync = vi.mocked(existsSync);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('findGitRepos', () => {
  it('finds repos with .git directories', () => {
    mockReaddirSync.mockReturnValue(['repo-a', 'repo-b', 'not-a-repo'] as unknown as ReturnType<typeof readdirSync>);
    mockStatSync.mockReturnValue({ isDirectory: () => true } as ReturnType<typeof statSync>);
    mockExistsSync.mockImplementation((path) => {
      const p = String(path);
      return p.includes('repo-a') || p.includes('repo-b');
    });
    mockExecSync.mockImplementation((_cmd, opts) => {
      const cwd = (opts as { cwd: string }).cwd;
      if (cwd.includes('repo-a')) return 'https://github.com/org/repo-a.git\n';
      if (cwd.includes('repo-b')) return 'git@github.com:org/repo-b.git\n';
      return '';
    });

    const repos = findGitRepos('/projects');

    expect(repos).toHaveLength(2);
    expect(repos[0]).toEqual({
      path: '/projects/repo-a',
      remoteUrl: 'https://github.com/org/repo-a.git',
    });
    expect(repos[1]).toEqual({
      path: '/projects/repo-b',
      remoteUrl: 'git@github.com:org/repo-b.git',
    });
  });

  it('skips directories without .git', () => {
    mockReaddirSync.mockReturnValue(['just-a-dir'] as unknown as ReturnType<typeof readdirSync>);
    mockStatSync.mockReturnValue({ isDirectory: () => true } as ReturnType<typeof statSync>);
    mockExistsSync.mockReturnValue(false);

    const repos = findGitRepos('/projects');
    expect(repos).toHaveLength(0);
  });

  it('skips non-directory entries', () => {
    mockReaddirSync.mockReturnValue(['file.txt'] as unknown as ReturnType<typeof readdirSync>);
    mockStatSync.mockReturnValue({ isDirectory: () => false } as ReturnType<typeof statSync>);

    const repos = findGitRepos('/projects');
    expect(repos).toHaveLength(0);
  });

  it('skips repos where git remote fails', () => {
    mockReaddirSync.mockReturnValue(['broken-repo'] as unknown as ReturnType<typeof readdirSync>);
    mockStatSync.mockReturnValue({ isDirectory: () => true } as ReturnType<typeof statSync>);
    mockExistsSync.mockReturnValue(true);
    mockExecSync.mockImplementation(() => { throw new Error('not a git repo'); });

    const repos = findGitRepos('/projects');
    expect(repos).toHaveLength(0);
  });

  it('returns empty array for unreadable directory', () => {
    mockReaddirSync.mockImplementation(() => { throw new Error('EACCES'); });

    const repos = findGitRepos('/nope');
    expect(repos).toHaveLength(0);
  });
});

describe('getMergeBase', () => {
  it('returns the merge-base SHA', () => {
    mockExecSync.mockReturnValue('abc123def456\n' as unknown as ReturnType<typeof execSync>);

    const result = getMergeBase('/repo', 'main');
    expect(result).toBe('abc123def456');
    expect(mockExecSync).toHaveBeenCalledWith(
      'git merge-base main HEAD',
      expect.objectContaining({ cwd: '/repo' }),
    );
  });
});

describe('getDiff', () => {
  it('returns the diff content', () => {
    mockExecSync.mockReturnValue('diff --git a/f.txt b/f.txt\n' as unknown as ReturnType<typeof execSync>);

    const result = getDiff('/repo', 'main');
    expect(result).toBe('diff --git a/f.txt b/f.txt');
    expect(mockExecSync).toHaveBeenCalledWith(
      'git diff main...HEAD',
      expect.objectContaining({ cwd: '/repo' }),
    );
  });
});
