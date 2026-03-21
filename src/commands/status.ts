import { Command, Flags } from '@oclif/core';
import { getStatus } from '../lib/status.js';

export default class Status extends Command {
  static override description =
    'Show dependency-ordered status of all PRs for a feature across workspace repos';

  static override examples = [
    '<%= config.bin %> status --feature add-auth',
    '<%= config.bin %> status --feature add-auth --json',
  ];

  static override flags = {
    feature: Flags.string({
      description: 'Feature branch name',
      required: true,
    }),
    json: Flags.boolean({
      description: 'Output as JSON',
      default: false,
    }),
    dir: Flags.string({
      description: 'Workspace root directory',
      default: '.',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Status);

    try {
      const status = await getStatus({
        workspaceDir: flags.dir,
        featureName: flags.feature,
      });

      if (flags.json) {
        this.log(JSON.stringify(status, null, 2));
        return;
      }

      // Render table
      this.log(
        `\nFeature: ${status.featureName} | Workspace: ${status.workspaceName}\n`,
      );

      const header = '  Repo          PR    CI      Reviews   Blocking';
      const separator =
        '  \u2500\u2500\u2500\u2500          \u2500\u2500    \u2500\u2500      \u2500\u2500\u2500\u2500\u2500\u2500\u2500   \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500';
      this.log(header);
      this.log(separator);

      for (const repo of status.repos) {
        const prCol = repo.prNumber ? `#${repo.prNumber}` : '\u2014';
        const ciCol = formatCI(repo.ci);
        const reviewCol = formatReviews(repo.reviews);
        const blockCol =
          repo.blocking.length > 0 ? repo.blocking.join(', ') : '\u2014';

        const name = repo.repoName.padEnd(14);
        const pr = prCol.padEnd(6);
        const ci = ciCol.padEnd(8);

        this.log(`  ${name}${pr}${ci}${reviewCol.padEnd(10)}${blockCol}`);
      }

      const blockingCount = status.repos.filter(
        (r) => r.blocking.length > 0,
      ).length;

      this.log('');
      if (status.mergeReady) {
        this.log('  Status: Ready to merge');
      } else {
        const reasons: string[] = [];
        if (blockingCount > 0) {
          reasons.push(`${blockingCount} repos blocking`);
        }
        const notPassing = status.repos.filter(
          (r) => r.prNumber !== null && r.ci !== 'pass',
        );
        if (notPassing.length > 0) {
          reasons.push(`${notPassing.length} CI not passing`);
        }
        const notApproved = status.repos.filter(
          (r) =>
            r.prNumber !== null &&
            (r.reviews.approved === 0 || r.reviews.changesRequested > 0),
        );
        if (notApproved.length > 0) {
          reasons.push(`${notApproved.length} not approved`);
        }
        const noPRs = status.repos.filter((r) => r.prNumber === null);
        if (noPRs.length > 0) {
          reasons.push(`${noPRs.length} repos without PRs`);
        }
        const reasonStr =
          reasons.length > 0 ? ` (${reasons.join(', ')})` : '';
        this.log(`  Status: Not ready to merge${reasonStr}`);
      }

      this.log('');

      if (!status.mergeReady) {
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

function formatCI(ci: string): string {
  switch (ci) {
    case 'pass':
      return '\u2705 pass';
    case 'fail':
      return '\u274C fail';
    case 'running':
      return '\uD83D\uDD04 run';
    case 'pending':
      return '\u23F3 wait';
    case 'none':
      return '\u2014 none';
    default:
      return ci;
  }
}

function formatReviews(reviews: {
  approved: number;
  changesRequested: number;
  pending: number;
  total: number;
}): string {
  const { approved, total } = reviews;
  if (total === 0) return '\u2014';
  const icon =
    approved === total && total > 0
      ? '\u2705'
      : reviews.changesRequested > 0
        ? '\u274C'
        : '\u23F3';
  return `${approved}/${total} ${icon}`;
}
