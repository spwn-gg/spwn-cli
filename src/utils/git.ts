import { execSync } from 'child_process';
import { readdirSync, statSync, existsSync } from 'fs';
import { join } from 'path';

const EXEC_OPTIONS = { encoding: 'utf-8' as const, timeout: 30000 };

export interface LocalRepo {
  path: string;
  remoteUrl: string;
}

/**
 * Scan a directory for immediate subdirectories that are git repos.
 * Returns each repo's path and origin remote URL.
 */
export function findGitRepos(dir: string): LocalRepo[] {
  const repos: LocalRepo[] = [];

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return repos;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    try {
      if (!statSync(fullPath).isDirectory()) continue;
      if (!existsSync(join(fullPath, '.git'))) continue;

      const remoteUrl = execSync('git remote get-url origin', {
        ...EXEC_OPTIONS,
        cwd: fullPath,
      }).trim();

      repos.push({ path: fullPath, remoteUrl });
    } catch {
      // Skip dirs where git remote fails
    }
  }

  return repos;
}

/**
 * Get the merge-base commit SHA between the given branch and HEAD.
 */
export function getMergeBase(repoPath: string, branch: string): string {
  return execSync(`git merge-base ${branch} HEAD`, {
    ...EXEC_OPTIONS,
    cwd: repoPath,
  }).trim();
}

/**
 * Get the unified diff of commits ahead of the given branch.
 */
export function getDiff(repoPath: string, branch: string): string {
  return execSync(`git diff ${branch}...HEAD`, {
    ...EXEC_OPTIONS,
    cwd: repoPath,
    maxBuffer: 10 * 1024 * 1024,
  }).trim();
}
