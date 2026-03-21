// Public API exports
export { init, readConfig, writeConfig, configExists, validateIntegrity } from './workspace.js';
export { registerBranch, checkout } from './branch.js';
export { createPRs } from './pr.js';
export { getStatus } from './status.js';
export { merge } from './merge.js';
export { detectDependencies, topologicalSort } from './deps.js';

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
