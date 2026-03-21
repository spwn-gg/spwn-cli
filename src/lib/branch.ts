import { join } from 'node:path';
import type { FeatureBranch, CheckoutResult } from './types.js';
import { readConfig, writeConfig } from './workspace.js';
import {
  isDirty,
  branchExists,
  createBranch,
  checkoutBranch,
} from './git.js';

const FEATURE_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9-]*$/;

export async function registerBranch(options: {
  workspaceDir: string;
  featureName: string;
}): Promise<FeatureBranch> {
  const { workspaceDir, featureName } = options;

  if (!featureName || !FEATURE_NAME_RE.test(featureName)) {
    throw new Error(
      `Invalid feature name "${featureName}". Must be alphanumeric with hyphens and cannot start with a hyphen.`,
    );
  }

  const config = await readConfig(workspaceDir);

  if (config.features.some((f) => f.name === featureName)) {
    throw new Error(
      `Feature "${featureName}" already exists in workspace "${config.name}".`,
    );
  }

  const feature: FeatureBranch = {
    name: featureName,
    createdAt: new Date().toISOString(),
    repos: [],
  };

  config.features.push(feature);
  config.lastUpdated = new Date().toISOString();
  await writeConfig(workspaceDir, config);

  return feature;
}

export async function checkout(options: {
  workspaceDir: string;
  featureName: string;
  repoName: string;
  force?: boolean;
}): Promise<CheckoutResult> {
  const { workspaceDir, featureName, repoName, force = false } = options;

  const config = await readConfig(workspaceDir);

  const feature = config.features.find((f) => f.name === featureName);
  if (!feature) {
    throw new Error(
      `Feature "${featureName}" not found. Register it first with "spwn branch".`,
    );
  }

  const repo = config.repos.find((r) => r.name === repoName);
  if (!repo) {
    throw new Error(
      `Repository "${repoName}" not found in workspace "${config.name}".`,
    );
  }

  const repoPath = join(workspaceDir, repo.path);

  if (!force && isDirty(repoPath)) {
    throw new Error(
      `Repository "${repoName}" is dirty (has uncommitted changes). Use --force to override.`,
    );
  }

  let created: boolean;

  if (branchExists(repoPath, featureName)) {
    checkoutBranch(repoPath, featureName);
    created = false;
  } else {
    createBranch(repoPath, featureName);
    checkoutBranch(repoPath, featureName);
    created = true;
  }

  if (!feature.repos.includes(repoName)) {
    feature.repos.push(repoName);
  }

  config.lastUpdated = new Date().toISOString();
  await writeConfig(workspaceDir, config);

  return {
    repoName,
    branchName: featureName,
    created,
  };
}
