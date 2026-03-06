type Vars = Record<string, string>;

export function packageJsonTemplate(v: Vars): string {
  return JSON.stringify(
    {
      name: v.PROJECT_NAME,
      version: '0.1.0',
      type: 'module',
      main: 'dist/index.js',
      scripts: {
        build: 'tsc',
        dev: 'tsx watch src/index.ts',
        start: 'node dist/index.js',
      },
      dependencies: {
        '@fabric-sdk/client': '^0.1.0',
        '@modelcontextprotocol/sdk': '^1.0.0',
      },
      devDependencies: {
        typescript: '^5.4.0',
        tsx: '^4.11.0',
        '@types/node': '^20.0.0',
      },
    },
    null,
    2,
  );
}

export function tsconfigTemplate(): string {
  return JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        declaration: true,
        outDir: 'dist',
        rootDir: 'src',
      },
      include: ['src'],
    },
    null,
    2,
  );
}

export function indexTemplate(v: Vars): string {
  return `// ${v.FABRIC_ID} -- Fabric-SDK fabric
// MCP server + gateway registration

import { FabricClient } from '@fabric-sdk/client';

const client = new FabricClient({
  gateway_url: process.env.GATEWAY_URL ?? 'http://localhost:7340',
  fabric_id: '${v.FABRIC_ID}',
  as_number: ${v.AS_NUMBER},
  version: '0.1.0',
  mcp_endpoint: \`http://\${process.env.HOST ?? 'localhost'}:\${process.env.PORT ?? '8080'}/mcp\`,
  supervisor: 'github-actions',
  tailscale_node: '${v.FABRIC_ID}',
  ollama_endpoint: process.env.OLLAMA_ENDPOINT,
  ollama_model: process.env.OLLAMA_MODEL ?? 'qwen2.5-coder:3b',
  routes: [
    // Define your knowledge domain prefixes here
    // { prefix: 'fabric.example', local_pref: 100, description: 'Example domain' },
  ],
  worker_pool: { total: 0, healthy: 0, workers: [] },
});

async function main(): Promise<void> {
  // Register with gateway
  const token = await client.register();
  console.log(\`Registered with gateway: \${token}\`);

  // Start keepalive heartbeat
  client.startKeepalive();

  // TODO: Set up your MCP server and tools here

  // Graceful shutdown
  const shutdown = async () => {
    await client.destroy();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error(\`Fatal: \${err.message}\`);
  process.exit(1);
});
`;
}

export function workerTemplate(v: Vars): string {
  return `// Example worker for ${v.FABRIC_ID}
// Workers communicate ONLY with their parent fabric via MCP (ADR-002 Section 3)
// Workers NEVER call the gateway, peer fabrics, or Claude directly

// Worker identity (ADR-002 Section 1)
export const WORKER_ID = '${v.FABRIC_ID}.example.01';
export const WORKER_TYPE = 'reactive' as const;

// Work unit: the durable artifact this worker produces (ADR-002 Section 4)
// For GitHub-supervised workers, this is typically a PR or issue
// The work unit must survive process death and be resumable

export interface WorkUnit {
  id: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  created_at: number;
  updated_at: number;
  result?: string;
}

export async function execute(input: unknown): Promise<WorkUnit> {
  const now = Math.floor(Date.now() / 1000);

  const unit: WorkUnit = {
    id: \`\${WORKER_ID}:\${now}\`,
    status: 'in_progress',
    created_at: now,
    updated_at: now,
  };

  try {
    // TODO: Implement your worker logic here
    // Call your fabric's MCP tools -- never external services directly

    unit.status = 'completed';
    unit.updated_at = Math.floor(Date.now() / 1000);
    return unit;
  } catch (err) {
    unit.status = 'failed';
    unit.result = (err as Error).message;
    unit.updated_at = Math.floor(Date.now() / 1000);
    return unit;
  }
}
`;
}

export function dockerfileTemplate(): string {
  return `FROM node:20-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-slim
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
CMD ["node", "dist/index.js"]
`;
}

export function envTemplate(v: Vars): string {
  return `# ${v.FABRIC_ID} environment variables
GATEWAY_URL=http://localhost:7340
HOST=0.0.0.0
PORT=8080
FABRIC_ID=${v.FABRIC_ID}
OLLAMA_ENDPOINT=http://localhost:11434
OLLAMA_MODEL=qwen2.5-coder:3b
`;
}
