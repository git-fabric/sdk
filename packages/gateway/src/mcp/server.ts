// src/mcp/server.ts
// Fastify HTTP server — gateway API surface
// Endpoints: register, keepalive, withdraw, dns, intercept, health, frib, audit

import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { GatewayConfig, FabricRegistration, KeepalivePayload, RouteUpdate, DNSQuery } from '../types/index.js';
import { FRIB } from '../frib/index.js';
import { Firewall } from '../firewall/index.js';
import { DNSResolver } from '../dns/index.js';
import { Interceptor } from '../interceptor/index.js';
import { logger } from '../core/logger.js';

export async function createServer(
  config: GatewayConfig,
  frib: FRIB,
  firewall: Firewall,
  dns: DNSResolver,
  interceptor: Interceptor,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  // ─── Health ─────────────────────────────────────────────────────

  app.get('/health', async () => {
    const sessions = await frib.allSessions();
    const routes   = await frib.allRoutes();
    return {
      status:        'ok',
      version:       '0.1.0',
      fabrics:       sessions.length,
      route_prefixes: routes.length,
      timestamp:     Math.floor(Date.now() / 1000),
    };
  });

  // ─── F-RIB table ────────────────────────────────────────────────

  app.get('/frib', async () => {
    const routes   = await frib.allRoutes();
    const sessions = await frib.allSessions();
    return { routes, sessions };
  });

  app.get('/frib/route/:prefix', async (req, reply) => {
    const { prefix } = req.params as { prefix: string };
    const entry = await frib.getByPrefix(decodeURIComponent(prefix));
    if (!entry) return reply.code(404).send({ error: 'Prefix not found in F-RIB' });
    return entry;
  });

  // ─── Registration (ADR-002 §7) ──────────────────────────────────

  app.post('/register', async (req, reply) => {
    const body = req.body as FabricRegistration;

    // Firewall: validate all route prefixes
    const prefixCheck = firewall.validatePrefixes(body.routes?.map(r => r.prefix) ?? []);
    if (prefixCheck.rejected.length > 0) {
      return reply.code(400).send({
        error:   'Invalid route prefixes',
        rejected: prefixCheck.rejected,
        reasons:  prefixCheck.reasons,
      });
    }

    // Filter to valid prefixes only
    const validRoutes = body.routes.filter(r => prefixCheck.valid.includes(r.prefix));
    const sanitizedBody: FabricRegistration = { ...body, routes: validRoutes };

    try {
      const session_token = await frib.register(sanitizedBody);
      const sessions      = await frib.allSessions();

      logger.info(`[Gateway] Fabric registered: ${body.fabric_id} AS${body.as_number}`);

      return {
        ok:            true,
        session_token,
        peer_count:    sessions.length,
        routes_accepted: validRoutes.length,
        routes_rejected: prefixCheck.rejected.length,
      };
    } catch (err) {
      logger.error(`[Gateway] Registration failed: ${(err as Error).message}`);
      return reply.code(500).send({ error: 'Registration failed', detail: (err as Error).message });
    }
  });

  // ─── Keepalive (ADR-002 §11) ────────────────────────────────────

  app.post('/keepalive', async (req, reply) => {
    const body = req.body as KeepalivePayload;
    const result = await frib.keepalive(body.fabric_id, body.session_token, body.worker_pool);

    if (!result.ok) {
      return reply.code(401).send({ error: 'Invalid session — re-register' });
    }

    return { ok: true, status: result.status, timestamp: Math.floor(Date.now() / 1000) };
  });

  // ─── Route withdrawal (ADR-002 §11) ─────────────────────────────

  app.post('/withdraw', async (req, reply) => {
    const body = req.body as RouteUpdate;

    if (body.action !== 'withdraw') {
      return reply.code(400).send({ error: 'Use action: withdraw' });
    }

    await frib.withdraw(
      body.fabric_id,
      body.session_token,
      body.routes?.map(r => r.prefix)
    );

    return { ok: true };
  });

  // ─── Route advertisement (update existing session) ───────────────

  app.post('/advertise', async (req, reply) => {
    const body = req.body as RouteUpdate;

    if (body.action !== 'advertise') {
      return reply.code(400).send({ error: 'Use action: advertise' });
    }

    const session = await frib.getSession(body.fabric_id);
    if (!session || session.session_token !== body.session_token) {
      return reply.code(401).send({ error: 'Invalid session — re-register' });
    }

    // Re-register with new routes (upsert)
    const prefixCheck = firewall.validatePrefixes(body.routes?.map(r => r.prefix) ?? []);
    const validRoutes = body.routes.filter(r => prefixCheck.valid.includes(r.prefix));

    // Patch the existing session's routes
    const patchedReg: FabricRegistration = {
      fabric_id:      body.fabric_id,
      as_number:      session.as_number,
      version:        '0.0.0',
      mcp_endpoint:   session.mcp_endpoint,
      ollama_endpoint: session.ollama_endpoint,
      supervisor:     '',
      tailscale_node: '',
      worker_pool:    { total: 1, healthy: 1, workers: [] },
      routes:         validRoutes,
    };
    await frib.register(patchedReg);

    return { ok: true, routes_accepted: validRoutes.length };
  });

  // ─── DNS resolution (ADR-002 §12) ───────────────────────────────

  app.post('/dns/resolve', async (req, reply) => {
    const body = req.body as DNSQuery;

    // Firewall inspection on the query text
    const fw = firewall.inspect(body.query_text, { fabric_id: body.requestor_fabric_id });
    if (!fw.allowed) {
      return reply.code(400).send({ error: fw.reason, audit_id: fw.audit_id });
    }

    const sanitizedQuery: DNSQuery = {
      ...body,
      query_text: fw.sanitized_input ?? body.query_text,
    };

    const result = await dns.resolve(sanitizedQuery);

    await frib.audit({
      audit_id:     result.query_hash,
      timestamp:    Math.floor(Date.now() / 1000),
      event_type:   'dns_resolve',
      fabric_id:    body.requestor_fabric_id,
      routing_lane: result.routing_lane,
      decision:     result.resolved ? 'resolved' : 'escalate',
    });

    return result;
  });

  // ─── Interceptor (path selection) ───────────────────────────────

  app.post('/intercept', async (req, reply) => {
    const body = req.body as {
      query_text:          string;
      domain_hint?:        string;
      requestor_fabric_id: string;
    };

    // Firewall first
    const fw = firewall.inspect(body.query_text, { fabric_id: body.requestor_fabric_id });
    if (!fw.allowed) {
      return reply.code(400).send({ error: fw.reason, audit_id: fw.audit_id });
    }

    const result = await interceptor.intercept({
      query_text:          fw.sanitized_input ?? body.query_text,
      domain_hint:         body.domain_hint,
      requestor_fabric_id: body.requestor_fabric_id,
    });

    return result;
  });

  // ─── Audit log ──────────────────────────────────────────────────

  app.get('/audit', async (req) => {
    const { limit = '100' } = req.query as { limit?: string };
    const entries = await frib.getAuditLog(parseInt(limit, 10));
    return { entries, count: entries.length };
  });

  return app;
}
