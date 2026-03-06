// src/firewall/index.ts
// L2 Firewall — policy enforcement, prompt injection detection, PII scrubbing
// First layer every request passes through before fabric routing

import { createHash } from 'crypto';
import type { FirewallDecision, GatewayConfig, AuditEntry } from '../types/index.js';
import { logger } from '../core/logger.js';

// Default prompt injection patterns — extend via config
const DEFAULT_INJECTION_PATTERNS = [
  /ignore\s+(previous|prior|above|all)\s+instructions?/i,
  /forget\s+(everything|all|your)\s+(previous|prior|above)/i,
  /you\s+are\s+now\s+(a\s+)?(different|new|unrestricted)/i,
  /jailbreak/i,
  /pretend\s+(you\s+are|to\s+be)/i,
  /act\s+as\s+(if\s+you\s+are\s+)?(?:an?\s+)?(?:unrestricted|uncensored|evil)/i,
  /<\s*script[^>]*>/i,
  /\bexec\s*\(/i,
  /\beval\s*\(/i,
  /\bsystem\s*\(/i,
];

// Default PII patterns — conservative set
const DEFAULT_PII_PATTERNS = [
  /\b\d{3}-\d{2}-\d{4}\b/,          // SSN
  /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/, // Credit card
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i, // Email (flag, don't always block)
  /\bpassword\s*[:=]\s*\S+/i,        // password: value
  /\bapi[_-]?key\s*[:=]\s*\S+/i,    // api_key: value
  /\btoken\s*[:=]\s*['"]\S+['"]/i,  // token: "value"
  /ghp_[a-zA-Z0-9]{36}/,            // GitHub PAT
  /sk-[a-zA-Z0-9]{48}/,             // OpenAI key pattern
];

export class Firewall {
  private injectionPatterns: RegExp[];
  private piiPatterns: RegExp[];
  private blockedPrefixes: string[];
  private enabled: boolean;

  constructor(config: GatewayConfig['firewall']) {
    this.enabled = config.enabled;
    this.blockedPrefixes = config.blocked_prefixes;

    // Merge config patterns with defaults
    this.injectionPatterns = [
      ...DEFAULT_INJECTION_PATTERNS,
      ...config.injection_patterns.map(p => new RegExp(p, 'i')),
    ];
    this.piiPatterns = [
      ...DEFAULT_PII_PATTERNS,
      ...config.pii_patterns.map(p => new RegExp(p, 'i')),
    ];
  }

  // ─── Main inspection entry point ──────────────────────────────

  inspect(input: string, context?: { fabric_id?: string; prefix?: string }): FirewallDecision {
    const audit_id = this.auditId();

    if (!this.enabled) {
      return {
        allowed:             true,
        pii_detected:        false,
        injection_detected:  false,
        sanitized_input:     input,
        audit_id,
      };
    }

    // 1. Prompt injection check
    const injectionMatch = this.injectionPatterns.find(p => p.test(input));
    if (injectionMatch) {
      logger.warn(`[Firewall] Injection detected audit=${audit_id} pattern=${injectionMatch.source.slice(0, 40)}`);
      return {
        allowed:             false,
        reason:              'Prompt injection pattern detected',
        pii_detected:        false,
        injection_detected:  true,
        audit_id,
      };
    }

    // 2. PII scrubbing (scrub, don't block — log detection)
    let sanitized = input;
    let pii_detected = false;
    for (const pattern of this.piiPatterns) {
      if (pattern.test(sanitized)) {
        pii_detected = true;
        sanitized = sanitized.replace(pattern, '[REDACTED]');
        logger.warn(`[Firewall] PII detected and scrubbed audit=${audit_id}`);
      }
    }

    // 3. Blocked prefix check (e.g. a fabric claiming 0.0.0.0/0)
    if (context?.prefix && this.blockedPrefixes.includes(context.prefix)) {
      logger.warn(`[Firewall] Blocked prefix=${context.prefix} fabric=${context.fabric_id} audit=${audit_id}`);
      return {
        allowed:             false,
        reason:              `Prefix ${context.prefix} is reserved and cannot be claimed by fabrics`,
        pii_detected,
        injection_detected:  false,
        audit_id,
      };
    }

    return {
      allowed:             true,
      sanitized_input:     sanitized,
      pii_detected,
      injection_detected:  false,
      audit_id,
    };
  }

  // ─── Registration-time prefix guard ───────────────────────────

  validatePrefixes(prefixes: string[]): { valid: string[]; rejected: string[]; reasons: Record<string, string> } {
    const valid: string[]                 = [];
    const rejected: string[]              = [];
    const reasons: Record<string, string> = {};

    for (const prefix of prefixes) {
      // Must be in fabric.* namespace
      if (!prefix.startsWith('fabric.') && prefix !== '0.0.0.0/0') {
        rejected.push(prefix);
        reasons[prefix] = 'Prefixes must be in fabric.* namespace';
        continue;
      }
      // Cannot claim blocked prefixes
      if (this.blockedPrefixes.includes(prefix)) {
        rejected.push(prefix);
        reasons[prefix] = `${prefix} is reserved`;
        continue;
      }
      valid.push(prefix);
    }

    return { valid, rejected, reasons };
  }

  private auditId(): string {
    return createHash('sha256').update(`${Date.now()}:${Math.random()}`).digest('hex').slice(0, 16);
  }
}
