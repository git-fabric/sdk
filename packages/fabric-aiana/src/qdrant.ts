// Fabric-SDK AIANA -- Qdrant client
// Direct REST API calls to Qdrant Cloud, no SDK dependency

import { scrub } from './scrub.js';
import type { MemoryRecord, SearchOptions, AddOptions, CollectionStats, HealthStatus } from './types.js';

const COLLECTION = 'aiana_fabric__memories__v1';

interface QdrantConfig {
  url: string;
  apiKey: string;
}

interface ScoredPoint {
  id: string;
  score: number;
  payload: Record<string, unknown>;
}

function headers(apiKey: string): Record<string, string> {
  return { 'Content-Type': 'application/json', 'api-key': apiKey };
}

async function request<T>(config: QdrantConfig, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${config.url}${path}`, {
    method,
    headers: headers(config.apiKey),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Qdrant ${method} ${path} -> ${res.status}: ${text}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) as T : {} as T;
}

function toRecord(point: ScoredPoint): MemoryRecord {
  const p = point.payload;
  return {
    id: String(point.id),
    content: String(p.content ?? ''),
    project: p.project as string | undefined,
    memoryType: (p.memoryType as MemoryRecord['memoryType']) ?? 'note',
    sessionId: p.sessionId as string | undefined,
    timestamp: String(p.timestamp ?? new Date().toISOString()),
    score: point.score,
    metadata: p.metadata as Record<string, unknown> | undefined,
  };
}

export class QdrantStore {
  private config: QdrantConfig;
  private ready: Promise<void>;

  constructor(config: QdrantConfig) {
    this.config = config;
    this.ready = this.ensureCollection();
  }

  private async ensureCollection(): Promise<void> {
    try {
      await request(this.config, 'GET', `/collections/${COLLECTION}`);
      return;
    } catch {
      // Create collection
    }

    await request(this.config, 'PUT', `/collections/${COLLECTION}`, {
      vectors: { size: 1536, distance: 'Cosine' },
      on_disk_payload: false,
    });

    for (const field of ['project', 'memoryType', 'sessionId']) {
      await request(this.config, 'PUT', `/collections/${COLLECTION}/index`, {
        field_name: field,
        field_schema: 'keyword',
      });
    }
    await request(this.config, 'PUT', `/collections/${COLLECTION}/index`, {
      field_name: 'timestamp',
      field_schema: 'datetime',
    });
  }

  async add(id: string, content: string, vector: number[], opts: AddOptions): Promise<void> {
    await this.ready;
    const clean = scrub(content);
    await request(this.config, 'PUT', `/collections/${COLLECTION}/points`, {
      points: [{
        id,
        vector,
        payload: {
          content: clean,
          project: opts.project,
          memoryType: opts.memoryType ?? 'note',
          sessionId: opts.sessionId,
          timestamp: new Date().toISOString(),
        },
      }],
    });
  }

  async search(vector: number[], opts: SearchOptions): Promise<MemoryRecord[]> {
    await this.ready;
    const body: Record<string, unknown> = {
      vector,
      limit: opts.limit ?? 10,
      score_threshold: opts.minScore ?? 0.5,
      with_payload: true,
    };
    if (opts.project) {
      body.filter = { must: [{ key: 'project', match: { value: opts.project } }] };
    }
    const result = await request<{ result: ScoredPoint[] }>(
      this.config, 'POST', `/collections/${COLLECTION}/points/search`, body,
    );
    return (result.result ?? []).map(toRecord);
  }

  async delete(id: string): Promise<void> {
    await this.ready;
    await request(this.config, 'POST', `/collections/${COLLECTION}/points/delete`, {
      points: [id],
    });
  }

  async scroll(project?: string, limit = 250): Promise<MemoryRecord[]> {
    await this.ready;
    const records: MemoryRecord[] = [];
    let offset: string | undefined;

    while (true) {
      const body: Record<string, unknown> = { limit, with_payload: true, with_vector: false };
      if (project) body.filter = { must: [{ key: 'project', match: { value: project } }] };
      if (offset) body.offset = offset;

      const result = await request<{
        result: { points: ScoredPoint[]; next_page_offset?: string };
      }>(this.config, 'POST', `/collections/${COLLECTION}/points/scroll`, body);

      const points = result.result?.points ?? [];
      for (const p of points) records.push(toRecord(p));

      const next = result.result?.next_page_offset;
      if (!next || points.length === 0) break;
      offset = next;
    }
    return records;
  }

  async recordFeedback(memoryId: string, query: string, rating: number, reason?: string): Promise<void> {
    await this.ready;
    const ts = new Date().toISOString();
    await request(this.config, 'POST', `/collections/${COLLECTION}/points/payload`, {
      points: [memoryId],
      payload: {
        [`feedback_${ts}`]: { query: scrub(query), rating, reason: reason ?? null, recordedAt: ts },
      },
    });
  }

  async stats(): Promise<CollectionStats> {
    await this.ready;
    const info = await request<{ result: { points_count: number } }>(
      this.config, 'GET', `/collections/${COLLECTION}`,
    );
    const all = await this.scroll();
    const byProject: Record<string, number> = {};
    for (const m of all) {
      const key = m.project ?? '(none)';
      byProject[key] = (byProject[key] ?? 0) + 1;
    }
    return {
      totalMemories: info.result?.points_count ?? 0,
      byProject,
      embeddingModel: 'text-embedding-3-small',
      collection: COLLECTION,
    };
  }

  async health(): Promise<HealthStatus> {
    const start = Date.now();
    try {
      await request(this.config, 'GET', `/collections/${COLLECTION}`);
      return { status: 'healthy', latencyMs: Date.now() - start };
    } catch {
      return { status: 'unavailable', latencyMs: Date.now() - start };
    }
  }
}
