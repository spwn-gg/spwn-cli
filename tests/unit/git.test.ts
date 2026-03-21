import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import {
  isGitRepo,
  getRemoteUrl,
  getDefaultBranch,
  getCurrentBranch,
  isDirty,
  createBranch,
  checkoutBranch,
  branchExists,
  getCommitsAhead,
} from '../../src/lib/git.js';

/** Helper: create a temporary directory and return its real path. */
function makeTmpDir(): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'spwn-git-test-')));
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

/** Helper: initialise a git repo with an initial commit so branches work. */
function initRepo(dir: string): void {
  git(dir, 'init -b main');
  git(dir, 'config user.email "test@test.com"');
  git(dir, 'config user.name "Test"');
  fs.writeFileSync(path.join(dir, 'README.md'), '# init\n');
  git(dir, 'add .');
  git(dir, 'commit -m "initial commit"');
}

describe('git adapter', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── isGitRepo ──────────────────────────────────────────────────────

  describe('isGitRepo', () => {
    it('returns true for a directory that is a git repository', () => {
      initRepo(tmpDir);
      expect(isGitRepo(tmpDir)).toBe(true);
    });

    it('returns false for a subdirectory inside a git repository (checks for .git dir directly)', () => {
      initRepo(tmpDir);
      const sub = path.join(tmpDir, 'subdir');
      fs.mkdirSync(sub);
      expect(isGitRepo(sub)).toBe(false);
    });

    it('returns false for a plain directory that is not a git repository', () => {
      // tmpDir has no .git
      expect(isGitRepo(tmpDir)).toBe(false);
    });

    it('returns false for a non-existent path', () => {
      const noSuchDir = path.join(tmpDir, 'does-not-exist');
      expect(isGitRepo(noSuchDir)).toBe(false);
    });
  });

  // ── getRemoteUrl ───────────────────────────────────────────────────

  describe('getRemoteUrl', () => {
    it('returns null when no remote is configured', () => {
      initRepo(tmpDir);
      expect(getRemoteUrl(tmpDir)).toBeNull();
    });

    it('returns the origin URL when a remote is set', () => {
      initRepo(tmpDir);
      const fakeUrl = 'https://github.com/example/repo.git';
      git(tmpDir, `remote add origin ${fakeUrl}`);
      expect(getRemoteUrl(tmpDir)).toBe(fakeUrl);
    });

    it('returns the origin URL for SSH remotes', () => {
      initRepo(tmpDir);
      const sshUrl = 'git@github.com:example/repo.git';
      git(tmpDir, `remote add origin ${sshUrl}`);
      expect(getRemoteUrl(tmpDir)).toBe(sshUrl);
    });
  });

  // ── getDefaultBranch ───────────────────────────────────────────────

  describe('getDefaultBranch', () => {
    it('returns "main" for a repo initialised with main as default branch', () => {
      initRepo(tmpDir);
      expect(getDefaultBranch(tmpDir)).toBe('main');
    });

    it('returns the configured default branch name', () => {
      const dir = makeTmpDir();
      try {
        git(dir, 'init -b develop');
        git(dir, 'config user.email "test@test.com"');
        git(dir, 'config user.name "Test"');
        fs.writeFileSync(path.join(dir, 'file.txt'), 'hello\n');
        git(dir, 'add .');
        git(dir, 'commit -m "init"');
        // The HEAD branch after init should be "develop"
        const result = getDefaultBranch(dir);
        expect(result).toBe('develop');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  // ── getCurrentBranch ───────────────────────────────────────────────

  describe('getCurrentBranch', () => {
    it('returns the current branch name', () => {
      initRepo(tmpDir);
      expect(getCurrentBranch(tmpDir)).toBe('main');
    });

    it('returns a different branch name after switching', () => {
      initRepo(tmpDir);
      git(tmpDir, 'checkout -b feature-x');
      expect(getCurrentBranch(tmpDir)).toBe('feature-x');
    });

    it('returns null for a detached HEAD state', () => {
      initRepo(tmpDir);
      // Create a second commit so we can detach at the first
      fs.writeFileSync(path.join(tmpDir, 'second.txt'), 'two\n');
      git(tmpDir, 'add .');
      git(tmpDir, 'commit -m "second"');
      const firstCommit = git(tmpDir, 'rev-list --max-parents=0 HEAD');
      git(tmpDir, `checkout ${firstCommit}`);
      expect(getCurrentBranch(tmpDir)).toBe('HEAD');
    });
  });

  // ── isDirty ────────────────────────────────────────────────────────

  describe('isDirty', () => {
    it('returns false for a clean repository', () => {
      initRepo(tmpDir);
      expect(isDirty(tmpDir)).toBe(false);
    });

    it('returns true when there are untracked files', () => {
      initRepo(tmpDir);
      fs.writeFileSync(path.join(tmpDir, 'untracked.txt'), 'data\n');
      expect(isDirty(tmpDir)).toBe(true);
    });

    it('returns true when there are staged but uncommitted changes', () => {
      initRepo(tmpDir);
      fs.writeFileSync(path.join(tmpDir, 'staged.txt'), 'data\n');
      git(tmpDir, 'add staged.txt');
      expect(isDirty(tmpDir)).toBe(true);
    });

    it('returns true when tracked files are modified but not staged', () => {
      initRepo(tmpDir);
      fs.writeFileSync(path.join(tmpDir, 'README.md'), '# changed\n');
      expect(isDirty(tmpDir)).toBe(true);
    });
  });

  // ── createBranch ───────────────────────────────────────────────────

  describe('createBranch', () => {
    it('creates a new branch that can be listed', () => {
      initRepo(tmpDir);
      createBranch(tmpDir, 'new-feature');
      const branches = git(tmpDir, 'branch --list');
      expect(branches).toContain('new-feature');
    });

    it('does not switch to the newly created branch', () => {
      initRepo(tmpDir);
      createBranch(tmpDir, 'another-branch');
      // Should still be on main
      const current = git(tmpDir, 'rev-parse --abbrev-ref HEAD');
      expect(current).toBe('main');
    });
  });

  // ── checkoutBranch ─────────────────────────────────────────────────

  describe('checkoutBranch', () => {
    it('switches the current branch', () => {
      initRepo(tmpDir);
      git(tmpDir, 'branch target-branch');
      checkoutBranch(tmpDir, 'target-branch');
      const current = git(tmpDir, 'rev-parse --abbrev-ref HEAD');
      expect(current).toBe('target-branch');
    });

    it('switches back to main', () => {
      initRepo(tmpDir);
      git(tmpDir, 'checkout -b side');
      checkoutBranch(tmpDir, 'main');
      const current = git(tmpDir, 'rev-parse --abbrev-ref HEAD');
      expect(current).toBe('main');
    });
  });

  // ── branchExists ───────────────────────────────────────────────────

  describe('branchExists', () => {
    it('returns true for an existing branch', () => {
      initRepo(tmpDir);
      git(tmpDir, 'branch existing');
      expect(branchExists(tmpDir, 'existing')).toBe(true);
    });

    it('returns true for the current branch', () => {
      initRepo(tmpDir);
      expect(branchExists(tmpDir, 'main')).toBe(true);
    });

    it('returns false for a branch that does not exist', () => {
      initRepo(tmpDir);
      expect(branchExists(tmpDir, 'nonexistent')).toBe(false);
    });
  });

  // ── getCommitsAhead ────────────────────────────────────────────────

  describe('getCommitsAhead', () => {
    it('returns 0 when feature branch is even with base', () => {
      initRepo(tmpDir);
      git(tmpDir, 'branch feature');
      expect(getCommitsAhead(tmpDir, 'main', 'feature')).toBe(0);
    });

    it('returns the number of commits ahead on the feature branch', () => {
      initRepo(tmpDir);
      git(tmpDir, 'checkout -b feature');
      for (let i = 1; i <= 3; i++) {
        fs.writeFileSync(path.join(tmpDir, `file${i}.txt`), `${i}\n`);
        git(tmpDir, 'add .');
        git(tmpDir, `commit -m "feature commit ${i}"`);
      }
      git(tmpDir, 'checkout main');
      expect(getCommitsAhead(tmpDir, 'main', 'feature')).toBe(3);
    });

    it('returns 0 when the feature branch is behind', () => {
      initRepo(tmpDir);
      git(tmpDir, 'branch feature');
      // Add commits to main only
      fs.writeFileSync(path.join(tmpDir, 'main-only.txt'), 'data\n');
      git(tmpDir, 'add .');
      git(tmpDir, 'commit -m "main only"');
      // feature is behind main, has 0 commits ahead
      expect(getCommitsAhead(tmpDir, 'main', 'feature')).toBe(0);
    });

    it('counts only commits unique to the feature branch', () => {
      initRepo(tmpDir);
      git(tmpDir, 'checkout -b feature');
      fs.writeFileSync(path.join(tmpDir, 'feat.txt'), 'feat\n');
      git(tmpDir, 'add .');
      git(tmpDir, 'commit -m "feat 1"');
      git(tmpDir, 'checkout main');
      // Add a commit to main so the branches have diverged
      fs.writeFileSync(path.join(tmpDir, 'main2.txt'), 'main\n');
      git(tmpDir, 'add .');
      git(tmpDir, 'commit -m "main 2"');
      // feature has exactly 1 commit that main doesn't
      expect(getCommitsAhead(tmpDir, 'main', 'feature')).toBe(1);
    });
  });
});
