import { Command, Args, Flags } from '@oclif/core';
import { switchFeature } from '../lib/branch.js';
import { configExists } from '../lib/workspace.js';

export default class Switch extends Command {
  static override description =
    'Switch to a feature branch across all materialized repos';

  static override examples = [
    '<%= config.bin %> switch my-feature',
    '<%= config.bin %> switch my-feature --dir /path/to/workspace',
  ];

  static override args = {
    feature: Args.string({
      description: 'Name of the registered feature branch',
      required: true,
    }),
  };

  static override flags = {
    dir: Flags.string({
      description: 'Workspace root directory',
      default: '.',
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Switch);
    const workspaceDir = flags.dir;
    const featureName = args.feature;

    if (!configExists(workspaceDir)) {
      this.error(
        `No workspace config found. Run "spwn init" first.`,
      );
    }

    try {
      const result = await switchFeature({
        workspaceDir,
        featureName,
      });

      for (const repoName of result.switched) {
        this.log(`Switched "${repoName}" to branch "${featureName}".`);
      }

      for (const { repoName, reason } of result.skipped) {
        this.warn(`Skipped "${repoName}": ${reason}`);
      }

      if (result.switched.length === 0) {
        this.warn('No repos were switched.');
      } else {
        this.log(
          `Switched ${result.switched.length} repo(s) to "${featureName}".`,
        );
      }
    } catch (error) {
      if (error instanceof Error) {
        this.error(error.message);
      }
      throw error;
    }
  }
}
