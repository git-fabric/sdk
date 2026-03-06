// Fabric-SDK AIANA -- types

export interface MemoryRecord {
  id: string;
  content: string;
  project?: string;
  memoryType: 'note' | 'preference' | 'pattern' | 'insight' | 'conversation';
  sessionId?: string;
  timestamp: string;
  score?: number;
  metadata?: Record<string, unknown>;
}

export interface SearchOptions {
  project?: string;
  limit?: number;
  minScore?: number;
}

export interface AddOptions {
  project?: string;
  memoryType?: string;
  sessionId?: string;
}

export interface CollectionStats {
  totalMemories: number;
  byProject: Record<string, number>;
  embeddingModel: string;
  collection: string;
}

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unavailable';
  latencyMs: number;
}
