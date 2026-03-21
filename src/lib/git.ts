import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

function git(repoPath: string, args: string[]): string {
  try {
    const result = execFileSync('git', args, {
      cwd: repoPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return result.trim();
  } catch {
    return '';
  }
}

function gitOrThrow(repoPath: string, args: string[]): string {
  const result = execFileSync('git', args, {
    cwd: repoPath,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return result.trim();
}

export function isGitRepo(path: string): boolean {
  return existsSync(join(path, '.git'));
}

export function getRemoteUrl(repoPath: string): string | null {
  const url = git(repoPath, ['remote', 'get-url', 'origin']);
  return url || null;
}

export function getDefaultBranch(repoPath: string): string {
  // Try symbolic-ref for HEAD
  const ref = git(repoPath, [
    'symbolic-ref',
    'refs/remotes/origin/HEAD',
    '--short',
  ]);
  if (ref) {
    return ref.replace('origin/', '');
  }

  // Fallback: check if main or master exists
  const branches = git(repoPath, ['branch', '--list']);
  if (branches.includes('main')) return 'main';
  if (branches.includes('master')) return 'master';

  // Last resort: current branch
  const current = getCurrentBranch(repoPath);
  return current ?? 'main';
}

export function getCurrentBranch(repoPath: string): string | null {
  const branch = git(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']);
  return branch || null;
}

export function isDirty(repoPath: string): boolean {
  const status = git(repoPath, ['status', '--porcelain']);
  return status.length > 0;
}

export function createBranch(repoPath: string, branchName: string): void {
  gitOrThrow(repoPath, ['branch', branchName]);
}

export function checkoutBranch(repoPath: string, branchName: string): void {
  gitOrThrow(repoPath, ['checkout', branchName]);
}

export function branchExists(repoPath: string, branchName: string): boolean {
  try {
    execFileSync(
      'git',
      ['show-ref', '--verify', '--quiet', `refs/heads/${branchName}`],
      { cwd: repoPath, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    return true;
  } catch {
    return false;
  }
}

export function deleteBranch(repoPath: string, branchName: string): void {
  gitOrThrow(repoPath, ['branch', '-D', branchName]);
}

export function getCommitsAhead(
  repoPath: string,
  baseBranch: string,
  featureBranch: string,
): number {
  const count = git(repoPath, [
    'rev-list',
    '--count',
    `${baseBranch}..${featureBranch}`,
  ]);
  return parseInt(count, 10) || 0;
}
