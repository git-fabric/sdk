import { Command } from 'commander';
import { scaffold } from './scaffold.js';

const program = new Command();

program
  .name('create-fabric-app')
  .description('Scaffold a new Fabric-SDK fabric project')
  .version('0.1.0')
  .argument('<project-name>', 'Name of the fabric project')
  .option('--fabric-id <id>', 'Fabric ID (defaults to project name)')
  .option('--as-number <number>', 'BGP AS number', '65100')
  .option('--skip-install', 'Skip npm install after scaffolding')
  .action(async (projectName: string, opts: Record<string, string>) => {
    await scaffold({
      projectName,
      fabricId: opts.fabricId ?? projectName,
      asNumber: parseInt(opts.asNumber ?? '65100', 10),
      skipInstall: !!opts.skipInstall,
    });
  });

program.parse();
