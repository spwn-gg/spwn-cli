import { Command } from 'commander';
import { readFileSync } from 'fs';
import { apiRequest } from '../utils/api-client.js';
import type {
  ChangesetResponse,
  ChangesetSummary,
  PushEntryResponse,
  ChangesetDiffResponse,
  ChangesetStatusResponse,
} from '@meridian/shared';

function basePath(workspaceId: string, intentId: string): string {
  return `/workspaces/${workspaceId}/intents/${intentId}/changesets`;
}

function printChangeset(cs: ChangesetResponse): void {
  console.log(`\nChangeset: ${cs.title}`);
  console.log(`  ID:          ${cs.id}`);
  console.log(`  Intent:      ${cs.intentId}`);
  console.log(`  Status:      ${cs.status}`);
  console.log(`  Version:     ${cs.version}`);
  console.log(`  Description: ${cs.description ?? '(none)'}`);
  if (cs.rejectionReason) {
    console.log(`  Reason:      ${cs.rejectionReason}`);
  }
  console.log(`  Created:     ${cs.createdAt}`);
  console.log(`  Updated:     ${cs.updatedAt}`);
  if (cs.entries.length > 0) {
    console.log(`  Entries (${cs.entries.length}):`);
    for (const e of cs.entries) {
      console.log(`    - ${e.repoUrl}`);
      console.log(`      ID: ${e.id}`);
      console.log(`      Base: ${e.baseCommitSha}`);
    }
  } else {
    console.log(`  Entries: (none)`);
  }
}

export function registerChangesetCommands(program: Command): void {
  const changeset = program.command('changeset').description('Manage changesets');

  // create
  changeset
    .command('create <workspaceId> <intentId>')
    .description('Create a new changeset')
    .requiredOption('--title <title>', 'Changeset title')
    .option('--description <desc>', 'Changeset description')
    .action(async (workspaceId: string, intentId: string, opts: { title: string; description?: string }) => {
      const { data } = await apiRequest('POST', basePath(workspaceId, intentId), {
        title: opts.title,
        description: opts.description,
      });
      printChangeset(data as ChangesetResponse);
    });

  // list
  changeset
    .command('list <workspaceId> <intentId>')
    .description('List changesets for an intent')
    .option('--status <status>', 'Filter by status (staged, approved, rejected)')
    .action(async (workspaceId: string, intentId: string, opts: { status?: string }) => {
      const query = opts.status ? `?status=${opts.status}` : '';
      const { data } = await apiRequest('GET', `${basePath(workspaceId, intentId)}${query}`);
      const items = data as ChangesetSummary[];

      if (items.length === 0) {
        console.log('No changesets found.');
        return;
      }

      console.log('\nChangesets:');
      for (const cs of items) {
        console.log(`  [${cs.status}] ${cs.title} (${cs.entryCount} entries) — ${cs.id}`);
      }
    });

  // show
  changeset
    .command('show <workspaceId> <intentId> <changesetId>')
    .description('Show changeset details')
    .action(async (workspaceId: string, intentId: string, changesetId: string) => {
      const { data } = await apiRequest('GET', `${basePath(workspaceId, intentId)}/${changesetId}`);
      printChangeset(data as ChangesetResponse);
    });

  // status
  changeset
    .command('status <workspaceId> <intentId> <changesetId>')
    .description('Show changeset status with repo coverage')
    .action(async (workspaceId: string, intentId: string, changesetId: string) => {
      const { data } = await apiRequest('GET', `${basePath(workspaceId, intentId)}/${changesetId}/status`);
      const s = data as ChangesetStatusResponse;

      console.log(`\nChangeset Status: ${s.status}`);
      console.log(`  Total intent repos: ${s.totalIntentRepos}`);

      if (s.coveredRepos.length > 0) {
        console.log(`  Covered (${s.coveredRepos.length}):`);
        for (const r of s.coveredRepos) {
          console.log(`    ✓ ${r.repoUrl}`);
        }
      }

      if (s.uncoveredRepos.length > 0) {
        console.log(`  Uncovered (${s.uncoveredRepos.length}):`);
        for (const r of s.uncoveredRepos) {
          console.log(`    ✗ ${r.repoUrl}`);
        }
      }
    });

  // push
  changeset
    .command('push <workspaceId> <intentId> <changesetId>')
    .description('Push a diff entry to a changeset')
    .requiredOption('--repo <repoReferenceId>', 'Repository reference ID')
    .requiredOption('--base-commit <sha>', 'Base commit SHA (40 hex chars)')
    .option('--file <path>', 'Read diff from file (otherwise reads from stdin)')
    .action(async (
      workspaceId: string,
      intentId: string,
      changesetId: string,
      opts: { repo: string; baseCommit: string; file?: string },
    ) => {
      let diffContent: string;

      if (opts.file) {
        diffContent = readFileSync(opts.file, 'utf-8');
      } else {
        // Read from stdin
        const chunks: Buffer[] = [];
        for await (const chunk of process.stdin) {
          chunks.push(chunk as Buffer);
        }
        diffContent = Buffer.concat(chunks).toString('utf-8');
      }

      if (!diffContent.trim()) {
        console.error('Error: No diff content provided');
        process.exit(1);
      }

      const { status, data } = await apiRequest(
        'POST',
        `${basePath(workspaceId, intentId)}/${changesetId}/entries`,
        {
          repoReferenceId: opts.repo,
          diffContent,
          baseCommitSha: opts.baseCommit,
        },
      );

      const entry = data as PushEntryResponse;
      const action = status === 200 ? 'Replaced' : 'Created';
      console.log(`\n${action} entry:`);
      console.log(`  ID:          ${entry.id}`);
      console.log(`  Repo:        ${entry.repoReferenceId}`);
      console.log(`  Base commit: ${entry.baseCommitSha}`);
    });

  // remove-entry
  changeset
    .command('remove-entry <workspaceId> <intentId> <changesetId> <entryId>')
    .description('Remove an entry from a staged changeset')
    .action(async (workspaceId: string, intentId: string, changesetId: string, entryId: string) => {
      // Get current version
      const { data: current } = await apiRequest('GET', `${basePath(workspaceId, intentId)}/${changesetId}`);
      const cs = current as ChangesetResponse;

      await apiRequest(
        'DELETE',
        `${basePath(workspaceId, intentId)}/${changesetId}/entries/${entryId}`,
        { version: cs.version },
      );
      console.log('Entry removed.');
    });

  // diff
  changeset
    .command('diff <workspaceId> <intentId> <changesetId>')
    .description('View diffs for a changeset')
    .option('--repo <repoReferenceId>', 'Filter to a single repo')
    .action(async (workspaceId: string, intentId: string, changesetId: string, opts: { repo?: string }) => {
      const query = opts.repo ? `?repoReferenceId=${opts.repo}` : '';
      const { data } = await apiRequest('GET', `${basePath(workspaceId, intentId)}/${changesetId}/diff${query}`);
      const response = data as ChangesetDiffResponse;

      if (response.diffs.length === 0) {
        console.log('No diffs in this changeset.');
        return;
      }

      for (const d of response.diffs) {
        console.log(`\n=== ${d.repoUrl} (base: ${d.baseCommitSha}) ===`);
        console.log(d.diffContent);
      }
    });

  // approve
  changeset
    .command('approve <workspaceId> <intentId> <changesetId>')
    .description('Approve a staged changeset')
    .action(async (workspaceId: string, intentId: string, changesetId: string) => {
      const { data: current } = await apiRequest('GET', `${basePath(workspaceId, intentId)}/${changesetId}`);
      const cs = current as ChangesetResponse;

      const { data } = await apiRequest(
        'POST',
        `${basePath(workspaceId, intentId)}/${changesetId}/approve`,
        { version: cs.version },
      );
      const result = data as { id: string; status: string; version: number };
      console.log(`\nChangeset approved.`);
      console.log(`  ID:      ${result.id}`);
      console.log(`  Status:  ${result.status}`);
      console.log(`  Version: ${result.version}`);
    });

  // reject
  changeset
    .command('reject <workspaceId> <intentId> <changesetId>')
    .description('Reject a staged changeset')
    .requiredOption('--reason <reason>', 'Reason for rejection')
    .action(async (workspaceId: string, intentId: string, changesetId: string, opts: { reason: string }) => {
      const { data: current } = await apiRequest('GET', `${basePath(workspaceId, intentId)}/${changesetId}`);
      const cs = current as ChangesetResponse;

      const { data } = await apiRequest(
        'POST',
        `${basePath(workspaceId, intentId)}/${changesetId}/reject`,
        { version: cs.version, reason: opts.reason },
      );
      const result = data as { id: string; status: string; rejectionReason: string; version: number };
      console.log(`\nChangeset rejected.`);
      console.log(`  ID:      ${result.id}`);
      console.log(`  Status:  ${result.status}`);
      console.log(`  Reason:  ${result.rejectionReason}`);
      console.log(`  Version: ${result.version}`);
    });
}
