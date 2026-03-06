import { describe, it, expect } from 'vitest';
import { scrub } from '../src/scrub.js';

describe('scrub', () => {
  it('redacts GitHub PATs', () => {
    expect(scrub('token: ghp_abcdefghijklmnopqrstuvwxyz1234567890')).toContain('[REDACTED]');
    expect(scrub('token: ghp_abcdefghijklmnopqrstuvwxyz1234567890')).not.toContain('ghp_');
  });

  it('redacts OpenAI keys', () => {
    expect(scrub('key: sk-abcdefghijklmnopqrstuvwxyz1234567890123456789012')).toContain('[REDACTED]');
  });

  it('redacts SSNs', () => {
    expect(scrub('SSN: 123-45-6789')).not.toContain('123-45-6789');
  });

  it('redacts credit cards', () => {
    expect(scrub('card: 4111 1111 1111 1111')).not.toContain('4111');
  });

  it('redacts password patterns', () => {
    expect(scrub('password = "mysecret"')).toContain('[REDACTED]');
    expect(scrub('password = "mysecret"')).not.toContain('mysecret');
  });

  it('passes clean text through', () => {
    const clean = 'Fix the broken CI pipeline for git-steer';
    expect(scrub(clean)).toBe(clean);
  });
});
