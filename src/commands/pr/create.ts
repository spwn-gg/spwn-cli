import { Command, Flags } from '@oclif/core';
import { createPRs } from '../../lib/pr.js';
import { detectFeature } from '../../lib/feature-detect.js';

export default class PRCreate extends Command {
  static override description =
    'Create coordinated PRs across all repos where the feature branch has changes';

  static override examples = [
    '<%= config.bin %> pr create --feature feat/add-auth --title "Add authentication"',
    '<%= config.bin %> pr create --feature feat/add-auth --title "Add auth" --body "Implements OAuth2" --draft',
  ];

  static override flags = {
    feature: Flags.string({
      description: 'Feature branch name (auto-detected from current branch if omitted)',
    }),
    title: Flags.string({
      description: 'PR title',
      required: true,
    }),
    body: Flags.string({
      description: 'PR description',
      default: '',
    }),
    draft: Flags.boolean({
      description: 'Create as draft PRs',
      default: false,
    }),
    dir: Flags.string({
      description: 'Workspace root directory',
      default: '.',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(PRCreate);

    try {
      const featureName = await detectFeature({
        workspaceDir: flags.dir,
        explicit: flags.feature,
      });

      const results = await createPRs({
        workspaceDir: flags.dir,
        featureName,
        title: flags.title,
        body: flags.body,
        draft: flags.draft,
      });

      const created = results.filter((r) => !r.skipped);
      const skipped = results.filter((r) => r.skipped);

      if (created.length === 0) {
        this.log('\nNo PRs created. All repos were skipped:');
        for (const r of skipped) {
          this.log(`  ${r.repoName}: ${r.skipReason}`);
        }
        return;
      }

      this.log(`\nCreated ${created.length} PR(s):\n`);
      for (const r of created) {
        this.log(`  ${r.repoName}: ${r.prUrl}`);
      }

      if (skipped.length > 0) {
        this.log('\nSkipped:');
        for (const r of skipped) {
          this.log(`  ${r.repoName}: ${r.skipReason}`);
        }
      }
    } catch (error) {
      if (error instanceof Error) {
        this.error(error.message);
      }
      throw error;
    }
  }
}
