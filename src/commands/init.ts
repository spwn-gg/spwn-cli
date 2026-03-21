import { Command, Flags } from '@oclif/core';
import { init, configExists } from '../lib/workspace.js';

export default class Init extends Command {
  static override description =
    'Initialize a workspace by scanning local repos and detecting dependencies';

  static override examples = [
    '<%= config.bin %> init --name my-workspace',
    '<%= config.bin %> init --name my-workspace --dir /path/to/repos',
  ];

  static override flags = {
    name: Flags.string({
      description: 'Workspace name',
      required: true,
    }),
    dir: Flags.string({
      description: 'Root directory to scan for repositories',
      default: '.',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Init);
    const dir = flags.dir;

    if (configExists(dir)) {
      this.error(
        'Workspace config already exists. Remove .spwn/workspace.json first.',
      );
    }

    try {
      const config = await init({ dir, name: flags.name });

      this.log(`\nWorkspace "${config.name}" initialized with ${config.repos.length} repositories:\n`);

      for (const repo of config.repos) {
        this.log(`  ${repo.name} (${repo.packageName}) — ${repo.path}`);
      }

      if (config.dependencies.length > 0) {
        this.log('\nDependencies detected:');
        for (const dep of config.dependencies) {
          this.log(`  ${dep.from} → ${dep.to} (${dep.type}: ${dep.packageName})`);
        }
      } else {
        this.log('\nNo cross-repo dependencies detected.');
      }

      this.log(`\nConfig saved to ${dir}/.spwn/workspace.json`);
    } catch (error) {
      if (error instanceof Error) {
        this.error(error.message);
      }
      throw error;
    }
  }
}
