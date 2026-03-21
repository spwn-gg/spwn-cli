import { join } from 'node:path';
import type { FeatureBranch, CheckoutResult, SwitchResult, DeleteFeatureResult } from './types.js';
import { readConfig, writeConfig } from './workspace.js';
import {
  isDirty,
  branchExists,
  createBranch,
  checkoutBranch,
  deleteBranch,
  getCurrentBranch,
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

export async function switchFeature(options: {
  workspaceDir: string;
  featureName: string;
}): Promise<SwitchResult> {
  const { workspaceDir, featureName } = options;

  const config = await readConfig(workspaceDir);

  const feature = config.features.find((f) => f.name === featureName);
  if (!feature) {
    throw new Error(
      `Feature "${featureName}" not found. Register it first with "spwn branch".`,
    );
  }

  const switched: string[] = [];
  const skipped: SwitchResult['skipped'] = [];

  for (const repoName of feature.repos) {
    const repo = config.repos.find((r) => r.name === repoName);
    if (!repo) {
      skipped.push({ repoName, reason: 'Repository not found in workspace config' });
      continue;
    }

    const repoPath = join(workspaceDir, repo.path);

    if (isDirty(repoPath)) {
      skipped.push({ repoName, reason: 'Has uncommitted changes' });
      continue;
    }

    checkoutBranch(repoPath, featureName);
    switched.push(repoName);
  }

  return { switched, skipped };
}

export async function deleteFeature(options: {
  workspaceDir: string;
  featureName: string;
  deleteBranches?: boolean;
}): Promise<DeleteFeatureResult> {
  const { workspaceDir, featureName, deleteBranches = false } = options;

  const config = await readConfig(workspaceDir);

  const featureIndex = config.features.findIndex((f) => f.name === featureName);
  if (featureIndex === -1) {
    throw new Error(
      `Feature "${featureName}" not found in workspace "${config.name}".`,
    );
  }

  const feature = config.features[featureIndex];
  const branchesDeleted: string[] = [];
  const branchesSkipped: string[] = [];

  if (deleteBranches) {
    for (const repoName of feature.repos) {
      const repo = config.repos.find((r) => r.name === repoName);
      if (!repo) continue;

      const repoPath = join(workspaceDir, repo.path);

      // Can't delete a branch that's currently checked out
      const currentBranch = getCurrentBranch(repoPath);
      if (currentBranch === featureName) {
        branchesSkipped.push(repoName);
        continue;
      }

      if (branchExists(repoPath, featureName)) {
        try {
          deleteBranch(repoPath, featureName);
          branchesDeleted.push(repoName);
        } catch {
          branchesSkipped.push(repoName);
        }
      }
    }
  }

  // Remove feature from config
  config.features.splice(featureIndex, 1);
  config.lastUpdated = new Date().toISOString();
  await writeConfig(workspaceDir, config);

  return {
    deleted: true,
    featureName,
    branchesDeleted,
    branchesSkipped,
  };
}
