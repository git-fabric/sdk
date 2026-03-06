import { describe, it, expect, vi } from 'vitest';
import { Interceptor } from '../src/interceptor/index.js';

function makeMockDNS(response: any) {
  return {
    resolve: vi.fn().mockResolvedValue(response),
  } as any;
}

function makeMockFRIB() {
  return {
    audit: vi.fn().mockResolvedValue(undefined),
  } as any;
}

const config = {
  default_confidence_floor: 0.7,
} as any;

describe('Interceptor', () => {
  it('routes to deterministic lane on high confidence', async () => {
    const dns = makeMockDNS({
      resolved: true,
      results: [{ fabric_id: 'git-steer', prefix: 'fabric.cve', context: 'CVE data', confidence: 0.98, source: 'fabric' }],
      routing_lane: 'deterministic',
      query_hash: 'abc123',
    });
    const frib = makeMockFRIB();
    const interceptor = new Interceptor(dns, frib, config);

    const result = await interceptor.intercept({
      query_text: 'Fix CVE-2024-1234',
      domain_hint: 'fabric.cve',
      requestor_fabric_id: 'test',
    });

    expect(result.lane).toBe('deterministic');
    expect(result.confidence).toBe(0.98);
    expect(result.target_fabric).toBe('git-steer');
    expect(frib.audit).toHaveBeenCalled();
  });

  it('routes to claude lane when nothing resolves', async () => {
    const dns = makeMockDNS({
      resolved: false,
      results: [],
      routing_lane: 'claude',
      claude_context: 'Some partial context',
      query_hash: 'def456',
    });
    const frib = makeMockFRIB();
    const interceptor = new Interceptor(dns, frib, config);

    const result = await interceptor.intercept({
      query_text: 'Something novel',
      requestor_fabric_id: 'test',
    });

    expect(result.lane).toBe('claude');
    expect(result.confidence).toBe(0);
    expect(result.context).toBe('Some partial context');
  });

  it('aggregates context from multiple results', async () => {
    const dns = makeMockDNS({
      resolved: true,
      results: [
        { fabric_id: 'a', prefix: 'fabric.a', context: 'Context A', confidence: 0.8, source: 'fabric' },
        { fabric_id: 'b', prefix: 'fabric.b', context: 'Context B', confidence: 0.75, source: 'aggregated' },
      ],
      routing_lane: 'local-llm',
      query_hash: 'ghi789',
    });
    const frib = makeMockFRIB();
    const interceptor = new Interceptor(dns, frib, config);

    const result = await interceptor.intercept({
      query_text: 'Cross-domain query',
      requestor_fabric_id: 'test',
    });

    expect(result.lane).toBe('local-llm');
    expect(result.context).toContain('Context A');
    expect(result.context).toContain('Context B');
  });
});
