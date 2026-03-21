import { Command } from 'commander';
import { apiRequest } from '../utils/api-client.js';
import type { MergeExecutionResponse } from '@meridian/shared';

function mergePath(workspaceId: string, intentId: string, changesetId: string): string {
  return `/workspaces/${workspaceId}/intents/${intentId}/changesets/${changesetId}/merge`;
}

function formatRepoStatus(r: MergeExecutionResponse['results'][0]): string {
  if (r.rollbackStatus === 'succeeded') return 'succeeded → rolled back';
  if (r.rollbackStatus === 'failed') return 'succeeded → rollback FAILED';
  if (r.rollbackStatus === 'skipped') return 'succeeded → rollback skipped (merged externally)';
  return r.status;
}

function printExecution(exec: MergeExecutionResponse): void {
  console.log(`\nMerge Execution: ${exec.id}`);
  console.log(`  Changeset: ${exec.changesetId}`);
  console.log(`  Status:    ${exec.status}`);
  console.log(`  Created:   ${exec.createdAt}`);
  if (exec.completedAt) {
    console.log(`  Completed: ${exec.completedAt}`);
  }

  if (exec.results.length > 0) {
    console.log(`\n  Results (${exec.results.length}):`);
    for (const r of exec.results) {
      const statusIcon = r.status === 'succeeded'
        ? (r.rollbackStatus === 'succeeded' ? '↩' : r.rollbackStatus === 'failed' ? '⚠' : '✓')
        : r.status === 'failed' ? '✗' : '…';
      console.log(`    ${statusIcon} ${r.repoUrl}`);
      console.log(`      Status: ${formatRepoStatus(r)}`);
      if (r.prUrl) {
        const prSuffix = r.rollbackStatus === 'succeeded' ? ' (closed)' :
                         r.rollbackStatus === 'failed' ? ' (NEEDS MANUAL CLEANUP)' : '';
        console.log(`      PR:     ${r.prUrl}${prSuffix}`);
      }
      if (r.branchName) {
        const branchSuffix = r.rollbackStatus === 'succeeded' ? ' (deleted)' :
                             r.rollbackStatus === 'failed' ? ' (NEEDS MANUAL CLEANUP)' : '';
        console.log(`      Branch: ${r.branchName}${branchSuffix}`);
      }
      if (r.errorMessage) {
        console.log(`      Error:  ${r.errorMessage}`);
      }
      if (r.rollbackErrorMessage) {
        console.log(`      Rollback error: ${r.rollbackErrorMessage}`);
      }
      if (r.retryCount > 0) {
        console.log(`      Retries: ${r.retryCount}`);
      }
    }
  }

  // Summary messages
  if (exec.status === 'rolled_back') {
    console.log('\n  Rollback completed. Changeset remains approved — fix the issue and retry.');
  } else if (exec.status === 'rollback_partial_failure') {
    console.log('\n  ⚠ Manual cleanup required for repos where rollback failed.');
  }
}

export function registerMergeCommands(program: Command): void {
  const merge = program.command('merge').description('Manage merge executions');

  // trigger
  merge
    .command('trigger <workspaceId> <intentId> <changesetId>')
    .description('Trigger merge for an approved changeset')
    .action(async (workspaceId: string, intentId: string, changesetId: string) => {
      const { data } = await apiRequest(
        'POST',
        mergePath(workspaceId, intentId, changesetId),
      );
      console.log('Merge triggered.');
      printExecution(data as MergeExecutionResponse);
    });

  // status
  merge
    .command('status <workspaceId> <intentId> <changesetId>')
    .description('Check merge execution status')
    .action(async (workspaceId: string, intentId: string, changesetId: string) => {
      const { data } = await apiRequest(
        'GET',
        mergePath(workspaceId, intentId, changesetId),
      );
      printExecution(data as MergeExecutionResponse);
    });

  // retry
  merge
    .command('retry <workspaceId> <intentId> <changesetId>')
    .description('Retry failed repos in a merge execution')
    .action(async (workspaceId: string, intentId: string, changesetId: string) => {
      const { data } = await apiRequest(
        'POST',
        `${mergePath(workspaceId, intentId, changesetId)}/retry`,
      );
      console.log('Retry triggered.');
      printExecution(data as MergeExecutionResponse);
    });
}
