import { Command } from 'commander';
import { apiRequest } from '../utils/api-client.js';
import type { IntentResponse, IntentListResponse } from '@meridian/shared';

function printIntent(intent: IntentResponse): void {
  console.log(`\nIntent: ${intent.title}`);
  console.log(`  ID:          ${intent.id}`);
  console.log(`  Workspace:   ${intent.workspaceId}`);
  console.log(`  Status:      ${intent.status}`);
  console.log(`  Version:     ${intent.version}`);
  console.log(`  Description: ${intent.description ?? '(none)'}`);
  console.log(`  Created:     ${intent.createdAt}`);
  console.log(`  Updated:     ${intent.updatedAt}`);
  console.log(`  Repos (${intent.repos.length}):`);
  for (const repo of intent.repos) {
    console.log(`    - ${repo.url}`);
    console.log(`      ID: ${repo.id}`);
  }
  if (intent.transitions.length > 0) {
    console.log(`  Transitions:`);
    for (const t of intent.transitions) {
      console.log(`    - ${t.fromStatus} → ${t.toStatus} (${t.createdAt})${t.reason ? ` — ${t.reason}` : ''}`);
    }
  }
}

export function registerIntentCommands(program: Command): void {
  const intent = program.command('intent').description('Manage intents');

  // create
  intent
    .command('create <workspaceId>')
    .description('Create a new intent')
    .requiredOption('--title <title>', 'Intent title')
    .option('--description <desc>', 'Intent description')
    .option('--repo <id...>', 'Repository reference IDs')
    .action(async (workspaceId: string, opts: { title: string; description?: string; repo?: string[] }) => {
      if (!opts.repo || opts.repo.length === 0) {
        console.error('Error: At least one --repo is required');
        process.exit(1);
      }

      const { data } = await apiRequest('POST', `/workspaces/${workspaceId}/intents`, {
        title: opts.title,
        description: opts.description,
        repoIds: opts.repo,
      });
      printIntent(data as IntentResponse);
    });

  // list
  intent
    .command('list <workspaceId>')
    .description('List intents in a workspace')
    .option('--status <status>', 'Filter by status (draft, active, retired)')
    .action(async (workspaceId: string, opts: { status?: string }) => {
      const query = opts.status ? `?status=${opts.status}` : '';
      const { data } = await apiRequest('GET', `/workspaces/${workspaceId}/intents${query}`);
      const response = data as IntentListResponse;

      if (response.intents.length === 0) {
        console.log('No intents found.');
        return;
      }

      console.log('\nIntents:');
      for (const i of response.intents) {
        console.log(`  [${i.status}] ${i.title} (${i.repoCount} repos) — ${i.id}`);
      }
    });

  // show
  intent
    .command('show <workspaceId> <intentId>')
    .description('Show intent details')
    .action(async (workspaceId: string, intentId: string) => {
      const { data } = await apiRequest('GET', `/workspaces/${workspaceId}/intents/${intentId}`);
      printIntent(data as IntentResponse);
    });

  // update
  intent
    .command('update <workspaceId> <intentId>')
    .description('Update an intent')
    .option('--title <title>', 'New title')
    .option('--description <desc>', 'New description')
    .option('--repo <id...>', 'New repository reference IDs (replaces current)')
    .action(async (workspaceId: string, intentId: string, opts: { title?: string; description?: string; repo?: string[] }) => {
      // Get current version
      const { data: current } = await apiRequest('GET', `/workspaces/${workspaceId}/intents/${intentId}`);
      const existing = current as IntentResponse;

      const body: Record<string, unknown> = { version: existing.version };
      if (opts.title) body['title'] = opts.title;
      if (opts.description) body['description'] = opts.description;
      if (opts.repo) body['repoIds'] = opts.repo;

      const { data } = await apiRequest('PATCH', `/workspaces/${workspaceId}/intents/${intentId}`, body);
      printIntent(data as IntentResponse);
    });

  // delete
  intent
    .command('delete <workspaceId> <intentId>')
    .description('Delete a draft intent')
    .action(async (workspaceId: string, intentId: string) => {
      await apiRequest('DELETE', `/workspaces/${workspaceId}/intents/${intentId}`);
      console.log('Intent deleted.');
    });

  // activate
  intent
    .command('activate <workspaceId> <intentId>')
    .description('Activate an intent (draft → active)')
    .option('--reason <reason>', 'Reason for activation')
    .action(async (workspaceId: string, intentId: string, opts: { reason?: string }) => {
      const { data: current } = await apiRequest('GET', `/workspaces/${workspaceId}/intents/${intentId}`);
      const existing = current as IntentResponse;

      const { data } = await apiRequest(
        'POST',
        `/workspaces/${workspaceId}/intents/${intentId}/transitions`,
        { version: existing.version, status: 'active', reason: opts.reason },
      );
      printIntent(data as IntentResponse);
    });

  // retire
  intent
    .command('retire <workspaceId> <intentId>')
    .description('Retire an intent (active → retired)')
    .requiredOption('--reason <reason>', 'Reason for retirement')
    .action(async (workspaceId: string, intentId: string, opts: { reason: string }) => {
      const { data: current } = await apiRequest('GET', `/workspaces/${workspaceId}/intents/${intentId}`);
      const existing = current as IntentResponse;

      const { data } = await apiRequest(
        'POST',
        `/workspaces/${workspaceId}/intents/${intentId}/transitions`,
        { version: existing.version, status: 'retired', reason: opts.reason },
      );
      printIntent(data as IntentResponse);
    });
}
