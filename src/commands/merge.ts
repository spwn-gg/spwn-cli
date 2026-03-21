import { Command, Flags } from '@oclif/core';
import { merge } from '../lib/merge.js';
import { detectFeature } from '../lib/feature-detect.js';

export default class Merge extends Command {
  static override description =
    'Merge feature branch PRs across repos in safe dependency order';

  static override examples = [
    '<%= config.bin %> merge --feature feat-1',
    '<%= config.bin %> merge --feature feat-1 --method squash',
    '<%= config.bin %> merge --feature feat-1 --dry-run',
  ];

  static override flags = {
    feature: Flags.string({
      description: 'Feature branch name (auto-detected from current branch if omitted)',
    }),
    method: Flags.string({
      description: 'Merge method',
      options: ['merge', 'squash', 'rebase'],
      default: 'merge',
    }),
    'dry-run': Flags.boolean({
      description: 'Show merge plan without executing',
      default: false,
    }),
    dir: Flags.string({
      description: 'Workspace root directory',
      default: '.',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Merge);

    const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
    if (!token) {
      this.error(
        'GitHub token not found. Set GH_TOKEN or GITHUB_TOKEN environment variable.',
      );
    }

    const featureName = await detectFeature({
      workspaceDir: flags.dir,
      explicit: flags.feature,
    });

    const dryRun = flags['dry-run'];

    if (dryRun) {
      this.log('\nDry run mode \u2014 showing merge plan without executing.\n');
    }

    try {
      const result = await merge({
        workspaceDir: flags.dir,
        featureName,
        githubToken: token,
        method: flags.method as 'merge' | 'squash' | 'rebase',
        dryRun,
      });

      for (const step of result.steps) {
        const icon =
          step.status === 'merged'
            ? '[MERGED]'
            : step.status === 'skipped'
              ? '[PLAN]'
              : '[FAILED]';
        const prInfo = step.prNumber > 0 ? ` (PR #${step.prNumber})` : '';
        this.log(`  ${icon} ${step.repoName}${prInfo}`);
        if (step.error) {
          this.log(`         ${step.error}`);
        }
      }

      if (result.allMerged) {
        this.log(
          `\nAll ${result.steps.length} PRs merged successfully in dependency order.`,
        );
      } else if (dryRun) {
        this.log(
          `\nMerge plan: ${result.steps.length} PRs would be merged in the order above.`,
        );
      } else if (result.guidance) {
        this.log(`\n${result.guidance}`);
      }

      if (result.failedAt) {
        this.exit(1);
      }
    } catch (error) {
      if (error instanceof Error) {
        this.error(error.message);
      }
      throw error;
    }
  }
}
