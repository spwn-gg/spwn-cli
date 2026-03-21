import { Command } from 'commander';
import { hostname } from 'os';
import { findGitRepos, getMergeBase, getDiff } from '../utils/git.js';
import { normalizeRepoUrl, repoUrlsMatch } from '../utils/url-normalize.js';
import { apiRequest } from '../utils/api-client.js';
import type { WorkspaceResponse, IntentResponse, RepoResponse } from '@meridian/shared';

interface ChangesetCreated {
  id: string;
  title: string;
}

interface MatchedRepo {
  localPath: string;
  localUrl: string;
  repoRef: RepoResponse;
}

interface DiffResult {
  matched: MatchedRepo;
  baseCommitSha: string;
  diffContent: string;
  lineCount: number;
}

export function registerPushCommands(program: Command): void {
  program
    .command('push <workspaceId> <intentId>')
    .description('Auto-detect local repos and push diffs to a changeset')
    .option('--dir <path>', 'Directory to scan for git repos', process.cwd())
    .option('--changeset <id>', 'Use existing changeset')
    .option('--title <title>', 'Changeset title when auto-creating')
    .option('--description <desc>', 'Changeset description when auto-creating')
    .action(async (
      workspaceId: string,
      intentId: string,
      opts: { dir: string; changeset?: string; title?: string; description?: string },
    ) => {
      // 1. Fetch workspace
      const { data: wsData } = await apiRequest('GET', `/workspaces/${workspaceId}`);
      const workspace = wsData as WorkspaceResponse;

      if (workspace.repos.length === 0) {
        console.error('Error: Workspace has no repository references.');
        process.exit(1);
      }

      // 2. Validate intent is active
      const { data: intentData } = await apiRequest(
        'GET',
        `/workspaces/${workspaceId}/intents/${intentId}`,
      );
      const intent = intentData as IntentResponse;

      if (intent.status !== 'active') {
        console.error(`Error: Intent status is "${intent.status}", must be "active".`);
        process.exit(1);
      }

      // 3. Scan directory for git repos
      const scanDir = opts.dir;
      console.log(`Scanning ${scanDir} for git repositories...`);
      const localRepos = findGitRepos(scanDir);

      if (localRepos.length === 0) {
        console.error(`Error: No git repositories found in ${scanDir}`);
        process.exit(1);
      }

      // 4. Match local repos to workspace repo references
      const matched: MatchedRepo[] = [];
      for (const local of localRepos) {
        const repoRef = workspace.repos.find((r) => repoUrlsMatch(local.remoteUrl, r.url));
        if (repoRef) {
          matched.push({ localPath: local.path, localUrl: local.remoteUrl, repoRef });
        }
      }

      if (matched.length === 0) {
        console.error('Error: No local repos match workspace repository references.');
        console.error('\nLocal repos found:');
        for (const local of localRepos) {
          console.error(`  ${normalizeRepoUrl(local.remoteUrl)}`);
        }
        console.error('\nWorkspace repos:');
        for (const repo of workspace.repos) {
          console.error(`  ${normalizeRepoUrl(repo.url)}`);
        }
        process.exit(1);
      }

      console.log(`  Found ${localRepos.length} repos, ${matched.length} match workspace`);

      // 5. Compute diffs
      console.log('\nComputing diffs...');
      const diffs: DiffResult[] = [];
      const skipped: string[] = [];

      for (const m of matched) {
        let baseCommitSha: string;
        try {
          baseCommitSha = getMergeBase(m.localPath, m.repoRef.defaultBranch);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`  ${repoName(m.localPath)}: warning — git merge-base failed, skipping (${msg.split('\n')[0]})`);
          skipped.push(repoName(m.localPath));
          continue;
        }

        let diffContent: string;
        try {
          diffContent = getDiff(m.localPath, m.repoRef.defaultBranch);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`  ${repoName(m.localPath)}: warning — git diff failed, skipping (${msg.split('\n')[0]})`);
          skipped.push(repoName(m.localPath));
          continue;
        }

        if (!diffContent) {
          console.log(`  ${repoName(m.localPath)}: no changes, skipping`);
          skipped.push(repoName(m.localPath));
          continue;
        }

        const lineCount = diffContent.split('\n').length;
        console.log(`  ${repoName(m.localPath)}: ${lineCount} lines changed (base: ${baseCommitSha.substring(0, 7)})`);
        diffs.push({ matched: m, baseCommitSha, diffContent, lineCount });
      }

      if (diffs.length === 0) {
        console.log('\nNo changes detected across matched repos.');
        return;
      }

      // 6. Create or reuse changeset
      let changesetId: string;

      if (opts.changeset) {
        changesetId = opts.changeset;
        console.log(`\nUsing existing changeset: ${changesetId}`);
      } else {
        const title = opts.title ?? `Push from ${hostname()} at ${new Date().toISOString()}`;
        const { data: csData } = await apiRequest(
          'POST',
          `/workspaces/${workspaceId}/intents/${intentId}/changesets`,
          { title, description: opts.description },
        );
        const cs = csData as ChangesetCreated;
        changesetId = cs.id;
        console.log(`\nCreated changeset: ${changesetId}`);
        console.log(`  Title: ${title}`);
      }

      // 7. Push entries
      console.log('\nPushing entries...');
      let pushErrors = 0;

      for (const d of diffs) {
        try {
          await apiRequest(
            'POST',
            `/workspaces/${workspaceId}/intents/${intentId}/changesets/${changesetId}/entries`,
            {
              repoReferenceId: d.matched.repoRef.id,
              diffContent: d.diffContent,
              baseCommitSha: d.baseCommitSha,
            },
          );
          console.log(`  ${repoName(d.matched.localPath)}: pushed`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`  ${repoName(d.matched.localPath)}: error — ${msg}`);
          pushErrors++;
        }
      }

      // 8. Summary
      const pushed = diffs.length - pushErrors;
      console.log(
        `\nDone. Changeset ${changesetId} — ${pushed} entr${pushed === 1 ? 'y' : 'ies'} pushed, ${skipped.length} skipped.`,
      );

      if (pushErrors > 0) {
        console.error(`${pushErrors} entr${pushErrors === 1 ? 'y' : 'ies'} failed to push.`);
        process.exit(1);
      }
    });
}

function repoName(repoPath: string): string {
  return repoPath.split('/').pop() ?? repoPath;
}
