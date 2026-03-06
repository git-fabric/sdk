import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import {
  packageJsonTemplate,
  tsconfigTemplate,
  indexTemplate,
  workerTemplate,
  dockerfileTemplate,
  envTemplate,
} from './templates/index.js';

interface ScaffoldOptions {
  projectName: string;
  fabricId: string;
  asNumber: number;
  skipInstall: boolean;
}

export async function scaffold(opts: ScaffoldOptions): Promise<void> {
  const root = join(process.cwd(), opts.projectName);

  console.log(`\nScaffolding fabric: ${opts.fabricId} (AS${opts.asNumber})`);
  console.log(`Directory: ${root}\n`);

  // Create directory structure
  mkdirSync(join(root, 'src', 'workers'), { recursive: true });

  // Write files
  const vars = {
    PROJECT_NAME: opts.projectName,
    FABRIC_ID: opts.fabricId,
    AS_NUMBER: String(opts.asNumber),
  };

  const files: [string, string][] = [
    ['package.json', packageJsonTemplate(vars)],
    ['tsconfig.json', tsconfigTemplate()],
    ['src/index.ts', indexTemplate(vars)],
    ['src/workers/example.ts', workerTemplate(vars)],
    ['Dockerfile', dockerfileTemplate()],
    ['.env.example', envTemplate(vars)],
  ];

  for (const [path, content] of files) {
    const fullPath = join(root, path);
    writeFileSync(fullPath, content, 'utf-8');
    console.log(`  created ${path}`);
  }

  // Install dependencies
  if (!opts.skipInstall) {
    console.log('\nInstalling dependencies...');
    execSync('npm install', { cwd: root, stdio: 'inherit' });
  }

  console.log(`
Done! Your fabric is ready.

Next steps:
  cd ${opts.projectName}
  # Edit src/index.ts to add your MCP tools
  # Edit src/workers/example.ts to implement your worker
  npm run dev
`);
}
