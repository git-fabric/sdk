// Fabric-SDK AIANA -- MCP tool definitions
// 11 tools: memory CRUD, search, recall, sessions, preferences, feedback, status, health

import { randomUUID } from 'crypto';
import { QdrantStore } from './qdrant.js';
import { EmbeddingProvider } from './embeddings.js';
import { scrub } from './scrub.js';
import type { MemoryRecord } from './types.js';

export interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

export function createTools(store: QdrantStore, embeddings: EmbeddingProvider): Tool[] {
  return [
    {
      name: 'aiana_memory_search',
      description: 'Semantic search over stored memories. Returns memories ranked by relevance.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Natural language search query.' },
          project: { type: 'string', description: 'Filter to a specific project.' },
          limit: { type: 'number', description: 'Max results. Default: 10.' },
          minScore: { type: 'number', description: 'Minimum similarity (0-1). Default: 0.5.' },
        },
        required: ['query'],
      },
      execute: async (args) => {
        const vector = await embeddings.embed(args.query as string);
        return store.search(vector, {
          project: args.project as string | undefined,
          limit: args.limit as number | undefined,
          minScore: args.minScore as number | undefined,
        });
      },
    },

    {
      name: 'aiana_memory_add',
      description: 'Store a new memory. Content is scrubbed for secrets before storage.',
      inputSchema: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'Memory content to store.' },
          memoryType: { type: 'string', enum: ['note', 'preference', 'pattern', 'insight'], description: 'Memory type. Default: note.' },
          project: { type: 'string', description: 'Associate with a project.' },
        },
        required: ['content'],
      },
      execute: async (args) => {
        const content = scrub(args.content as string);
        const id = randomUUID();
        const vector = await embeddings.embed(content);
        await store.add(id, content, vector, {
          project: args.project as string | undefined,
          memoryType: args.memoryType as string | undefined,
        });
        return { id, stored: true };
      },
    },

    {
      name: 'aiana_memory_recall',
      description: 'Recall the most relevant memories for a project.',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'Project name to recall context for.' },
          maxItems: { type: 'number', description: 'Max memories to return. Default: 5.' },
        },
        required: ['project'],
      },
      execute: async (args) => {
        const vector = await embeddings.embed(args.project as string);
        return store.search(vector, {
          project: args.project as string,
          limit: args.maxItems as number ?? 5,
          minScore: 0.3,
        });
      },
    },

    {
      name: 'aiana_memory_delete',
      description: 'Permanently delete a memory by ID.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Memory ID to delete.' },
        },
        required: ['id'],
      },
      execute: async (args) => {
        await store.delete(args.id as string);
        return { id: args.id, deleted: true };
      },
    },

    {
      name: 'aiana_memory_export',
      description: 'Export all memories. Optionally filter by project.',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'Export only this project.' },
        },
      },
      execute: async (args) => store.scroll(args.project as string | undefined),
    },

    {
      name: 'aiana_memory_import',
      description: 'Import memories from an exported array. Duplicate IDs are overwritten.',
      inputSchema: {
        type: 'object',
        properties: {
          memories: {
            type: 'array',
            description: 'Array of memory records.',
            items: { type: 'object' },
          },
        },
        required: ['memories'],
      },
      execute: async (args) => {
        const memories = args.memories as MemoryRecord[];
        let imported = 0;
        for (const m of memories) {
          const content = scrub(m.content);
          const vector = await embeddings.embed(content);
          const id = m.id ?? randomUUID();
          await store.add(id, content, vector, {
            project: m.project,
            memoryType: m.memoryType,
            sessionId: m.sessionId,
          });
          imported++;
        }
        return { imported };
      },
    },

    {
      name: 'aiana_session_list',
      description: 'List sessions grouped by project, sorted by most recent activity.',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'Filter to a project.' },
          limit: { type: 'number', description: 'Max sessions. Default: 20.' },
        },
      },
      execute: async (args) => {
        const all = await store.scroll(args.project as string | undefined);
        const groups = new Map<string, MemoryRecord[]>();
        for (const m of all) {
          if (!m.sessionId) continue;
          const arr = groups.get(m.sessionId) ?? [];
          arr.push(m);
          groups.set(m.sessionId, arr);
        }
        const summaries = [...groups.entries()].map(([sessionId, records]) => {
          records.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
          return {
            sessionId,
            project: records[records.length - 1].project,
            memoryCount: records.length,
            firstSeen: records[0].timestamp,
            lastSeen: records[records.length - 1].timestamp,
            preview: records[records.length - 1].content.slice(0, 120),
          };
        });
        summaries.sort((a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime());
        return summaries.slice(0, (args.limit as number) ?? 20);
      },
    },

    {
      name: 'aiana_preference_add',
      description: 'Store a user preference as a searchable memory.',
      inputSchema: {
        type: 'object',
        properties: {
          preference: { type: 'string', description: 'The preference to store.' },
          project: { type: 'string', description: 'Associate with a project.' },
        },
        required: ['preference'],
      },
      execute: async (args) => {
        const content = scrub(args.preference as string);
        const id = randomUUID();
        const vector = await embeddings.embed(content);
        await store.add(id, content, vector, {
          project: args.project as string | undefined,
          memoryType: 'preference',
        });
        return { id, stored: true, memoryType: 'preference' };
      },
    },

    {
      name: 'aiana_memory_feedback',
      description: 'Record feedback on a memory. Rating: 1=helpful, 0=neutral, -1=not helpful.',
      inputSchema: {
        type: 'object',
        properties: {
          memoryId: { type: 'string', description: 'Memory ID.' },
          query: { type: 'string', description: 'Original query that surfaced this memory.' },
          rating: { type: 'number', enum: [1, 0, -1], description: 'Helpfulness rating.' },
          reason: { type: 'string', description: 'Optional explanation.' },
        },
        required: ['memoryId', 'query', 'rating'],
      },
      execute: async (args) => {
        await store.recordFeedback(
          args.memoryId as string,
          args.query as string,
          args.rating as number,
          args.reason as string | undefined,
        );
        return { memoryId: args.memoryId, rating: args.rating, recorded: true };
      },
    },

    {
      name: 'aiana_status',
      description: 'Collection stats: total count, per-project counts, embedding model.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => store.stats(),
    },

    {
      name: 'aiana_health',
      description: 'Ping Qdrant and return connection status and latency.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => store.health(),
    },
  ];
}
