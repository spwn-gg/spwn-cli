import { Command, Args, Flags } from '@oclif/core';
import { revert } from '../lib/revert.js';
import { readHistory } from '../lib/history.js';
import { configExists } from '../lib/workspace.js';

export default class Revert extends Command {
  static override description =
    'Revert a previously merged feature by creating revert PRs in reverse dependency order';

  static override examples = [
    '<%= config.bin %> revert add-auth',
    '<%= config.bin %> revert add-auth --dry-run',
    '<%= config.bin %> revert',
  ];

  static override args = {
    feature: Args.string({
      description: 'Name of the merged feature to revert',
      required: false,
    }),
  };

  static override flags = {
    'dry-run': Flags.boolean({
      description: 'Show revert plan without executing',
      default: false,
    }),
    dir: Flags.string({
      description: 'Workspace root directory',
      default: '.',
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Revert);
    const workspaceDir = flags.dir;

    if (!configExists(workspaceDir)) {
      this.error('No workspace config found. Run "spwn init" first.');
    }

    // No feature — list merge history
    if (!args.feature) {
      const history = readHistory(workspaceDir);
      if (history.entries.length === 0) {
        this.log('No merge history found. Nothing to revert.');
        return;
      }

      this.log('Merge history:\n');
      for (const entry of history.entries) {
        const repos = entry.steps.map((s) => s.repoName).join(', ');
        this.log(`  ${entry.featureName}  (merged ${entry.mergedAt}, repos: ${repos})`);
      }

      this.log('\nUsage: spwn revert <feature>');
      return;
    }

    const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
    if (!token) {
      this.error('GitHub token not found. Set GH_TOKEN or GITHUB_TOKEN environment variable.');
    }

    const dryRun = flags['dry-run'];

    if (dryRun) {
      this.log('\nDry run mode — showing revert plan without executing.\n');
    }

    try {
      const result = await revert({
        workspaceDir,
        featureName: args.feature,
        githubToken: token,
        dryRun,
      });

      for (const step of result.steps) {
        const icon =
          step.status === 'reverted'
            ? '[REVERT PR]'
            : step.status === 'skipped'
              ? '[PLAN]'
              : '[FAILED]';

        this.log(`  ${icon} ${step.repoName} (PR #${step.prNumber})`);
        if (step.revertPrUrl) {
          this.log(`          ${step.revertPrUrl}`);
        }
        if (step.error) {
          this.log(`          ${step.error}`);
        }
      }

      if (result.allReverted) {
        this.log(`\nRevert PRs created for "${result.featureName}". Review and merge them to complete the rollback.`);
      } else if (dryRun) {
        this.log(`\nRevert plan: ${result.steps.length} repos would get revert PRs in reverse dependency order.`);
      }
    } catch (error) {
      if (error instanceof Error) {
        this.error(error.message);
      }
      throw error;
    }
  }
}
