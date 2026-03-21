// CLI-local types — complement to @spwn/shared (which serves the backend API domain)

export type ManifestType =
  | 'package.json'
  | 'go.mod'
  | 'Cargo.toml'
  | 'pyproject.toml';

export interface RepoConfig {
  name: string;
  path: string; // Relative to workspace root
  url: string;
  defaultBranch: string;
  packageName: string;
  manifestType: ManifestType;
}

export interface DependencyEdge {
  from: string;
  to: string;
  type: 'runtime' | 'dev' | 'peer';
  packageName: string;
}

export interface FeatureBranch {
  name: string;
  createdAt: string; // ISO 8601
  repos: string[]; // Repo names where branch has been materialized
}

export interface WorkspaceConfig {
  version: 1;
  name: string;
  repos: RepoConfig[];
  dependencies: DependencyEdge[];
  features: FeatureBranch[];
  lastUpdated: string; // ISO 8601
}

export interface TopologicalSortResult {
  sorted: RepoConfig[];
  hasCycle: boolean;
  cycle: string[];
}

export interface CheckoutResult {
  repoName: string;
  branchName: string;
  created: boolean; // true if new branch, false if switched to existing
}

export interface PRCreateResult {
  repoName: string;
  prUrl: string;
  prNumber: number;
  skipped: boolean;
  skipReason?: string;
}

export interface RepoStatus {
  repoName: string;
  prNumber: number | null;
  prUrl: string | null;
  ci: 'pass' | 'fail' | 'running' | 'pending' | 'none';
  reviews: {
    approved: number;
    changesRequested: number;
    pending: number;
    total: number;
  };
  blocking: string[]; // Repo names this depends on that aren't merged
}

export interface WorkspaceStatus {
  workspaceName: string;
  featureName: string;
  repos: RepoStatus[];
  mergeReady: boolean;
}

export interface MergeStepResult {
  repoName: string;
  prNumber: number;
  status: 'merged' | 'failed' | 'skipped';
  error?: string;
}

export interface MergeResult {
  steps: MergeStepResult[];
  allMerged: boolean;
  failedAt?: string; // Repo name where failure occurred
  guidance?: string;
}

export interface SwitchResult {
  switched: string[];  // repo names successfully switched
  skipped: Array<{ repoName: string; reason: string }>;
}

export interface DeleteFeatureResult {
  deleted: boolean;
  featureName: string;
  branchesDeleted: string[];  // repos where git branch was deleted
  branchesSkipped: string[];  // repos where branch couldn't be deleted (e.g. checked out)
}

export interface GitInfo {
  isRepo: boolean;
  remoteUrl: string | null;
  defaultBranch: string | null;
  currentBranch: string | null;
  isDirty: boolean;
}

export interface PRStatus {
  number: number;
  url: string;
  state: 'open' | 'closed' | 'merged';
  mergeable: boolean | null;
  ci: 'pass' | 'fail' | 'running' | 'pending' | 'none';
  reviews: {
    approved: number;
    changesRequested: number;
    pending: number;
  };
}
