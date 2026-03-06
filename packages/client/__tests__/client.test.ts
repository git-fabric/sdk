import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FabricClient } from '../src/client.js';

vi.mock('axios', () => {
  const mockInstance = {
    post: vi.fn(),
    get: vi.fn(),
  };
  return {
    default: {
      create: vi.fn(() => mockInstance),
      __mockInstance: mockInstance,
    },
  };
});

import axios from 'axios';
const mockHttp = (axios as any).__mockInstance;

function makeClient() {
  return new FabricClient({
    gateway_url: 'http://localhost:7340',
    fabric_id: 'test-fabric',
    as_number: 65001,
    version: '1.0.0',
    mcp_endpoint: 'http://localhost:8080/mcp',
    supervisor: 'github-actions',
    tailscale_node: 'test',
    routes: [{ prefix: 'fabric.test', local_pref: 100, description: 'Test' }],
    worker_pool: { total: 1, healthy: 1, workers: [] },
  });
}

describe('FabricClient', () => {
  let client: FabricClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = makeClient();
  });

  afterEach(async () => {
    client.stopKeepalive();
  });

  describe('register', () => {
    it('sends registration and stores session token', async () => {
      mockHttp.post.mockResolvedValueOnce({
        data: { ok: true, session_token: 'tok_abc123' },
      });

      const token = await client.register();
      expect(token).toBe('tok_abc123');
      expect(client.sessionToken).toBe('tok_abc123');
      expect(mockHttp.post).toHaveBeenCalledWith('/register', expect.objectContaining({
        fabric_id: 'test-fabric',
        as_number: 65001,
      }));
    });
  });

  describe('keepalive', () => {
    it('sends keepalive with token', async () => {
      mockHttp.post.mockResolvedValueOnce({ data: { session_token: 'tok' } });
      await client.register();

      mockHttp.post.mockResolvedValueOnce({ status: 200, data: { ok: true } });
      await client.keepalive();

      expect(mockHttp.post).toHaveBeenCalledWith('/keepalive', expect.objectContaining({
        fabric_id: 'test-fabric',
        session_token: 'tok',
      }));
    });

    it('throws when no session exists', async () => {
      await expect(client.keepalive()).rejects.toThrow('No active session');
    });
  });

  describe('withdraw', () => {
    it('calls gateway withdraw endpoint', async () => {
      mockHttp.post.mockResolvedValueOnce({ data: { session_token: 'tok' } });
      await client.register();

      mockHttp.post.mockResolvedValueOnce({ data: { ok: true } });
      await client.withdraw(['fabric.test']);

      expect(mockHttp.post).toHaveBeenCalledWith('/withdraw', expect.objectContaining({
        action: 'withdraw',
      }));
    });
  });

  describe('intercept', () => {
    it('sends intercept request', async () => {
      mockHttp.post.mockResolvedValueOnce({
        data: { lane: 'deterministic', confidence: 0.98, target_fabric: 'git-steer', audit_id: 'x' },
      });

      const result = await client.intercept('Fix CVE-2024-1234', 'fabric.cve');
      expect(result.lane).toBe('deterministic');
      expect(result.confidence).toBe(0.98);
    });
  });

  describe('destroy', () => {
    it('withdraws and clears session', async () => {
      mockHttp.post.mockResolvedValueOnce({ data: { session_token: 'tok' } });
      await client.register();

      mockHttp.post.mockResolvedValueOnce({ data: { ok: true } });
      await client.destroy();

      expect(client.sessionToken).toBeNull();
    });
  });
});
