// Fabric-SDK AIANA -- entrypoint
// Registers with gateway as AS65005, starts MCP server, advertises fabric.memory

import { FabricClient } from '@fabric-sdk/client';
import { QdrantStore } from './qdrant.js';
import { EmbeddingProvider } from './embeddings.js';
import { createTools } from './tools.js';
import type { Tool } from './tools.js';

export { QdrantStore } from './qdrant.js';
export { EmbeddingProvider } from './embeddings.js';
export { createTools } from './tools.js';
export type { Tool } from './tools.js';
export type { MemoryRecord, SearchOptions, AddOptions, CollectionStats, HealthStatus } from './types.js';

interface AianaConfig {
  gatewayUrl?: string;
  qdrantUrl: string;
  qdrantApiKey: string;
  openaiApiKey: string;
  ollamaEndpoint?: string;
  ollamaModel?: string;
  port?: number;
  host?: string;
}

function loadConfig(): AianaConfig {
  const qdrantUrl = process.env.QDRANT_URL;
  if (!qdrantUrl) throw new Error('QDRANT_URL is required');
  const qdrantApiKey = process.env.QDRANT_API_KEY;
  if (!qdrantApiKey) throw new Error('QDRANT_API_KEY is required');
  const openaiApiKey = process.env.OPENAI_API_KEY;
  if (!openaiApiKey) throw new Error('OPENAI_API_KEY is required');

  return {
    gatewayUrl: process.env.GATEWAY_URL,
    qdrantUrl,
    qdrantApiKey,
    openaiApiKey,
    ollamaEndpoint: process.env.OLLAMA_ENDPOINT,
    ollamaModel: process.env.OLLAMA_MODEL,
    port: parseInt(process.env.PORT ?? '8100', 10),
    host: process.env.HOST ?? '0.0.0.0',
  };
}

async function main(): Promise<void> {
  const config = loadConfig();

  // Initialize Qdrant store and embedding provider
  const store = new QdrantStore({ url: config.qdrantUrl, apiKey: config.qdrantApiKey });
  const embeddings = new EmbeddingProvider(config.openaiApiKey);
  const tools = createTools(store, embeddings);

  console.log(`[fabric-aiana] ${tools.length} MCP tools loaded`);

  // Health check on startup
  const health = await store.health();
  console.log(`[fabric-aiana] Qdrant: ${health.status} (${health.latencyMs}ms)`);

  // Register with gateway if URL is provided
  let client: FabricClient | null = null;

  if (config.gatewayUrl) {
    client = new FabricClient({
      gateway_url: config.gatewayUrl,
      fabric_id: 'fabric-aiana',
      as_number: 65005,
      version: '0.1.0',
      mcp_endpoint: `http://${config.host}:${config.port}/mcp`,
      supervisor: 'standalone',
      tailscale_node: 'fabric-aiana',
      ollama_endpoint: config.ollamaEndpoint,
      ollama_model: config.ollamaModel ?? 'qwen2.5-coder:3b',
      routes: [
        { prefix: 'fabric.memory', local_pref: 100, description: 'Semantic memory, cross-fabric context, embeddings' },
        { prefix: 'fabric.memory.search', local_pref: 100, description: 'Memory search and recall' },
        { prefix: 'fabric.memory.sessions', local_pref: 100, description: 'Session tracking and context' },
      ],
      worker_pool: { total: 0, healthy: 0, workers: [] },
    });

    try {
      const token = await client.register();
      console.log(`[fabric-aiana] Registered with gateway: ${token}`);
      client.startKeepalive();
    } catch (err) {
      console.warn(`[fabric-aiana] Gateway registration failed (standalone mode): ${(err as Error).message}`);
      client = null;
    }
  } else {
    console.log('[fabric-aiana] No GATEWAY_URL -- running standalone');
  }

  // Simple HTTP server for MCP tool calls
  const server = (globalThis as any).Bun?.serve ?? null;
  if (!server) {
    // Node.js path
    const { createServer } = await import('http');

    const httpServer = createServer(async (req, res) => {
      if (req.method === 'GET' && req.url === '/health') {
        const h = await store.health();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: h.status, latencyMs: h.latencyMs, tools: tools.length, fabric: 'fabric-aiana' }));
        return;
      }

      if (req.method === 'GET' && req.url === '/tools') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(tools.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }))));
        return;
      }

      if (req.method === 'POST' && req.url === '/tools/call') {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const body = JSON.parse(Buffer.concat(chunks).toString()) as { name: string; arguments: Record<string, unknown> };

        const tool = tools.find(t => t.name === body.name);
        if (!tool) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Tool not found: ${body.name}` }));
          return;
        }

        try {
          const result = await tool.execute(body.arguments ?? {});
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: (err as Error).message }));
        }
        return;
      }

      // aiana_query endpoint -- used by gateway DNS resolver for unicast resolution
      if (req.method === 'POST' && req.url === '/mcp/tools/call') {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const body = JSON.parse(Buffer.concat(chunks).toString()) as { name: string; arguments: Record<string, unknown> };

        if (body.name === 'aiana_query') {
          const queryText = body.arguments.query_text as string;
          const topK = (body.arguments.top_k as number) ?? 5;
          const vector = await embeddings.embed(queryText);
          const results = await store.search(vector, { limit: topK, minScore: 0.3 });

          const context = results.map(r => r.content).join('\n\n---\n\n');
          const confidence = results.length > 0 ? results[0].score ?? 0 : 0;

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ context, confidence }));
          return;
        }

        // Fall through to regular tool call
        const tool = tools.find(t => t.name === body.name);
        if (!tool) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Tool not found: ${body.name}` }));
          return;
        }
        const result = await tool.execute(body.arguments ?? {});
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    });

    httpServer.listen(config.port, config.host, () => {
      console.log(`[fabric-aiana] Listening on ${config.host}:${config.port}`);
      console.log(`[fabric-aiana] Endpoints: /health /tools /tools/call /mcp/tools/call`);
    });
  }

  // Graceful shutdown
  const shutdown = async () => {
    console.log('[fabric-aiana] Shutting down');
    if (client) await client.destroy();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

// CLI direct execution
if (process.argv[1]?.endsWith('index.js') || process.argv[1]?.endsWith('index.ts')) {
  main().catch((err) => {
    console.error(`[fabric-aiana] Fatal: ${err.message}`);
    process.exit(1);
  });
}
