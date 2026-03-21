// Public API exports
export { init, readConfig, writeConfig, configExists, validateIntegrity } from './workspace.js';
export { registerBranch, checkout } from './branch.js';
export { createPRs } from './pr.js';
export { getStatus } from './status.js';
export { merge } from './merge.js';
export { detectDependencies, topologicalSort } from './deps.js';
export { detectFeature } from './feature-detect.js';
export { listFeatures, listRepos } from './list.js';

// List types
export type { FeatureInfo, RepoInfo } from './list.js';

// Types
export type {
  WorkspaceConfig,
  RepoConfig,
  DependencyEdge,
  FeatureBranch,
  ManifestType,
  TopologicalSortResult,
  CheckoutResult,
  PRCreateResult,
  WorkspaceStatus,
  RepoStatus,
  MergeResult,
  MergeStepResult,
  GitInfo,
  PRStatus,
} from './types.js';
