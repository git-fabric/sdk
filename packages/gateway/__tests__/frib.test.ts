import { describe, it, expect, beforeEach } from 'vitest';
import { FRIB } from '../src/frib/index.js';

// In-memory Redis mock
function createRedisMock() {
  const store = new Map<string, string>();
  const lists = new Map<string, string[]>();

  return {
    store,
    async get(key: string) { return store.get(key) ?? null; },
    async set(key: string, value: string, _ex?: string, _ttl?: number) { store.set(key, value); return 'OK'; },
    async del(key: string) { store.delete(key); return 1; },
    async keys(pattern: string) {
      const prefix = pattern.replace('*', '');
      return [...store.keys()].filter(k => k.startsWith(prefix));
    },
    async mget(...keys: string[]) {
      return keys.map(k => store.get(k) ?? null);
    },
    async lpush(key: string, value: string) {
      const list = lists.get(key) ?? [];
      list.unshift(value);
      lists.set(key, list);
      return list.length;
    },
    async ltrim(key: string, start: number, stop: number) {
      const list = lists.get(key) ?? [];
      lists.set(key, list.slice(start, stop + 1));
      return 'OK';
    },
    async lrange(key: string, start: number, stop: number) {
      const list = lists.get(key) ?? [];
      return list.slice(start, stop + 1);
    },
  } as any;
}

function makeRegistration(overrides?: Partial<{
  fabric_id: string; as_number: number; routes: { prefix: string; local_pref: number; description: string }[];
}>) {
  return {
    fabric_id: overrides?.fabric_id ?? 'test-fabric',
    as_number: overrides?.as_number ?? 65001,
    version: '1.0.0',
    mcp_endpoint: 'http://test:8080/mcp',
    supervisor: 'github-actions',
    tailscale_node: 'test',
    worker_pool: {
      total: 2,
      healthy: 2,
      workers: [
        { worker_id: 'test.w1', status: 'healthy', reported_at: 0 },
        { worker_id: 'test.w2', status: 'healthy', reported_at: 0 },
      ],
    },
    routes: overrides?.routes ?? [
      { prefix: 'fabric.test', local_pref: 100, description: 'Test domain' },
    ],
  };
}

describe('FRIB', () => {
  let redis: ReturnType<typeof createRedisMock>;
  let frib: FRIB;

  beforeEach(() => {
    redis = createRedisMock();
    frib = new FRIB(redis);
  });

  describe('register', () => {
    it('creates session and F-RIB entries', async () => {
      const token = await frib.register(makeRegistration());
      expect(token).toBeTruthy();
      expect(token.length).toBe(24);

      const session = await frib.getSession('test-fabric');
      expect(session).not.toBeNull();
      expect(session!.fabric_id).toBe('test-fabric');
      expect(session!.status).toBe('active');

      const route = await frib.getByPrefix('fabric.test');
      expect(route).not.toBeNull();
      expect(route!.fabric_id).toBe('test-fabric');
      expect(route!.local_pref).toBe(100);
    });

    it('handles prefix conflict — lower pref rejected', async () => {
      await frib.register(makeRegistration({
        fabric_id: 'fabric-a',
        routes: [{ prefix: 'fabric.shared', local_pref: 100, description: 'A' }],
      }));

      await frib.register(makeRegistration({
        fabric_id: 'fabric-b',
        routes: [{ prefix: 'fabric.shared', local_pref: 50, description: 'B' }],
      }));

      const route = await frib.getByPrefix('fabric.shared');
      expect(route!.fabric_id).toBe('fabric-a');
    });

    it('handles prefix takeover — higher pref wins', async () => {
      await frib.register(makeRegistration({
        fabric_id: 'fabric-a',
        routes: [{ prefix: 'fabric.shared', local_pref: 50, description: 'A' }],
      }));

      await frib.register(makeRegistration({
        fabric_id: 'fabric-b',
        routes: [{ prefix: 'fabric.shared', local_pref: 100, description: 'B' }],
      }));

      const route = await frib.getByPrefix('fabric.shared');
      expect(route!.fabric_id).toBe('fabric-b');
    });
  });

  describe('keepalive', () => {
    it('succeeds with valid token', async () => {
      const token = await frib.register(makeRegistration());
      const result = await frib.keepalive('test-fabric', token, { total: 2, healthy: 2, workers: [{ status: 'healthy' }, { status: 'healthy' }] });
      expect(result.ok).toBe(true);
      expect(result.status).toBe('active');
    });

    it('fails with invalid token', async () => {
      await frib.register(makeRegistration());
      const result = await frib.keepalive('test-fabric', 'wrong-token', { total: 1, healthy: 1, workers: [] });
      expect(result.ok).toBe(false);
    });

    it('degrades routes when worker health drops below 50%', async () => {
      const token = await frib.register(makeRegistration());
      await frib.keepalive('test-fabric', token, {
        total: 4, healthy: 1,
        workers: [{ status: 'healthy' }, { status: 'failed' }, { status: 'failed' }, { status: 'failed' }],
      });

      const route = await frib.getByPrefix('fabric.test');
      expect(route!.worker_health).toBe('degraded');
      expect(route!.local_pref).toBeLessThan(100);
    });
  });

  describe('withdraw', () => {
    it('removes specific prefixes', async () => {
      const token = await frib.register(makeRegistration({
        routes: [
          { prefix: 'fabric.a', local_pref: 100, description: 'A' },
          { prefix: 'fabric.b', local_pref: 100, description: 'B' },
        ],
      }));

      await frib.withdraw('test-fabric', token, ['fabric.a']);

      expect(await frib.getByPrefix('fabric.a')).toBeNull();
      expect(await frib.getByPrefix('fabric.b')).not.toBeNull();

      const session = await frib.getSession('test-fabric');
      expect(session).not.toBeNull();
    });

    it('full withdrawal removes session', async () => {
      const token = await frib.register(makeRegistration());
      await frib.withdraw('test-fabric', token);

      expect(await frib.getByPrefix('fabric.test')).toBeNull();
      expect(await frib.getSession('test-fabric')).toBeNull();
    });
  });

  describe('resolve', () => {
    it('exact match', async () => {
      await frib.register(makeRegistration());
      const result = await frib.resolve('fabric.test');
      expect(result).not.toBeNull();
      expect(result!.fabric_id).toBe('test-fabric');
    });

    it('parent prefix match', async () => {
      await frib.register(makeRegistration({
        routes: [{ prefix: 'fabric.cve', local_pref: 100, description: 'CVE' }],
      }));
      const result = await frib.resolve('fabric.cve.npm');
      expect(result).not.toBeNull();
      expect(result!.prefix).toBe('fabric.cve');
    });

    it('returns null for no match', async () => {
      const result = await frib.resolve('fabric.unknown');
      expect(result).toBeNull();
    });
  });

  describe('resolveAll', () => {
    it('sorts by prefix length, then local_pref', async () => {
      await frib.register(makeRegistration({
        fabric_id: 'broad',
        routes: [{ prefix: 'fabric.cve', local_pref: 100, description: 'CVE' }],
      }));
      await frib.register(makeRegistration({
        fabric_id: 'specific',
        routes: [{ prefix: 'fabric.cve.npm', local_pref: 80, description: 'NPM CVE' }],
      }));

      const results = await frib.resolveAll('fabric.cve');
      expect(results.length).toBe(2);
      expect(results[0].prefix).toBe('fabric.cve.npm'); // longer prefix first
    });
  });
});
