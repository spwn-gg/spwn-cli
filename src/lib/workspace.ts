import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
} from 'node:fs';
import { join, relative } from 'node:path';
import type { WorkspaceConfig, RepoConfig } from './types.js';
import { isGitRepo, getRemoteUrl, getDefaultBranch } from './git.js';
import { detectDependencies, topologicalSort } from './deps.js';

const CONFIG_DIR = '.spwn';
const CONFIG_FILE = 'workspace.json';

function configPath(dir: string): string {
  return join(dir, CONFIG_DIR, CONFIG_FILE);
}

export async function readConfig(dir: string): Promise<WorkspaceConfig> {
  const path = configPath(dir);
  if (!existsSync(path)) {
    throw new Error(`No workspace config found at ${path}`);
  }
  const content = readFileSync(path, 'utf-8');
  return JSON.parse(content) as WorkspaceConfig;
}

export async function writeConfig(
  dir: string,
  config: WorkspaceConfig,
): Promise<void> {
  const dirPath = join(dir, CONFIG_DIR);
  mkdirSync(dirPath, { recursive: true });
  const path = configPath(dir);
  writeFileSync(path, JSON.stringify(config, null, 2), 'utf-8');
}

export function configExists(dir: string): boolean {
  return existsSync(configPath(dir));
}

export async function validateIntegrity(
  dir: string,
): Promise<{ valid: boolean; errors: string[] }> {
  const config = await readConfig(dir);
  const errors: string[] = [];
  for (const repo of config.repos) {
    const repoPath = join(dir, repo.path);
    if (!existsSync(repoPath)) {
      errors.push(`Repository '${repo.name}' not found at ${repo.path}`);
    } else if (!isGitRepo(repoPath)) {
      errors.push(`'${repo.path}' is not a git repository`);
    }
  }
  return { valid: errors.length === 0, errors };
}

function readPackageName(repoPath: string): string | null {
  const pkgPath = join(repoPath, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      return pkg.name ?? null;
    } catch {
      return null;
    }
  }
  return null;
}

function detectManifestType(
  repoPath: string,
): 'package.json' | 'go.mod' | 'Cargo.toml' | 'pyproject.toml' | null {
  if (existsSync(join(repoPath, 'package.json'))) return 'package.json';
  if (existsSync(join(repoPath, 'go.mod'))) return 'go.mod';
  if (existsSync(join(repoPath, 'Cargo.toml'))) return 'Cargo.toml';
  if (existsSync(join(repoPath, 'pyproject.toml'))) return 'pyproject.toml';
  return null;
}

export async function init(options: {
  dir: string;
  name: string;
}): Promise<WorkspaceConfig> {
  const { dir, name } = options;

  if (configExists(dir)) {
    throw new Error(
      `Workspace config already exists at ${configPath(dir)}. Remove it first or use a different directory.`,
    );
  }

  // Scan immediate children for git repos
  const entries = readdirSync(dir, { withFileTypes: true });
  const repos: RepoConfig[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.')) continue; // Skip hidden dirs like .spwn, .git
    const repoPath = join(dir, entry.name);
    if (!isGitRepo(repoPath)) continue;

    const manifestType = detectManifestType(repoPath);
    const packageName = readPackageName(repoPath) ?? entry.name;
    const remoteUrl = getRemoteUrl(repoPath) ?? '';
    const defaultBranch = getDefaultBranch(repoPath);

    repos.push({
      name: entry.name,
      path: `./${relative(dir, repoPath)}`,
      url: remoteUrl,
      defaultBranch,
      packageName,
      manifestType: manifestType ?? 'package.json',
    });
  }

  if (repos.length === 0) {
    throw new Error(
      `No git repositories found in ${dir}. Ensure the directory contains git repositories as immediate children.`,
    );
  }

  // Detect dependencies
  // Need absolute paths for dependency scanning
  const reposWithAbsPaths = repos.map((r) => ({
    ...r,
    path: join(dir, r.path),
  }));
  const dependencies = detectDependencies(reposWithAbsPaths);

  // Validate no cycles
  const sortResult = topologicalSort(reposWithAbsPaths, dependencies);
  if (sortResult.hasCycle) {
    throw new Error(
      `Circular dependency detected: ${sortResult.cycle.join(' → ')}. Cannot create workspace with circular dependencies.`,
    );
  }

  const config: WorkspaceConfig = {
    version: 1,
    name,
    repos,
    dependencies,
    features: [],
    lastUpdated: new Date().toISOString(),
  };

  await writeConfig(dir, config);
  return config;
}
