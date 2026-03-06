#!/usr/bin/env node
import { Command } from 'commander';
import { start } from '../dist/index.js';

const program = new Command();

program
  .name('fabric-gateway')
  .description('Fabric-SDK Gateway -- BGP-style route reflector for autonomous fabric agents')
  .version('0.1.0');

program
  .command('start')
  .description('Start the gateway server')
  .option('-c, --config <path>', 'Path to gateway.yaml config file')
  .action((opts) => {
    start(opts.config).catch((err) => {
      console.error(`Fatal: ${err.message}`);
      process.exit(1);
    });
  });

program.parse();
