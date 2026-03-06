// test-routing.ts
// Integration test: registers git-steer with the SDK gateway, then
// sends queries through the interceptor to prove local routing works.
//
// Prerequisites:
//   1. Redis running on localhost:6379
//   2. Gateway running on localhost:7340
//   3. git-steer bridge running on localhost:8200

import axios from 'axios';

const GATEWAY = process.env.GATEWAY_URL ?? 'http://localhost:7340';
const BRIDGE  = process.env.BRIDGE_URL  ?? 'http://localhost:8200';

async function waitForService(url: string, name: string, retries = 10): Promise<void> {
  for (let i = 0; i < retries; i++) {
    try {
      await axios.get(`${url}/health`, { timeout: 2000 });
      console.log(`  [ok] ${name} is up`);
      return;
    } catch {
      if (i === retries - 1) throw new Error(`${name} not reachable at ${url}`);
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

async function main() {
  console.log('\n=== Fabric-SDK Integration Test ===\n');

  // 1. Wait for services
  console.log('1. Checking services...');
  await waitForService(GATEWAY, 'Gateway');
  await waitForService(BRIDGE, 'git-steer bridge');

  // 2. Register git-steer as AS65001
  console.log('\n2. Registering git-steer as AS65001...');
  const regResp = await axios.post(`${GATEWAY}/register`, {
    fabric_id: 'git-steer',
    as_number: 65001,
    version: '0.3.0',
    mcp_endpoint: BRIDGE,
    ollama_endpoint: 'http://localhost:11434',
    ollama_model: 'qwen2.5-coder:3b',
    supervisor: 'github-actions',
    tailscale_node: 'git-steer-mac',
    worker_pool: { total: 1, healthy: 1, workers: [] },
    routes: [
      { prefix: 'fabric.github',   local_pref: 100, description: 'GitHub repository management' },
      { prefix: 'fabric.github.repos',    local_pref: 100, description: 'Repository CRUD' },
      { prefix: 'fabric.github.branches', local_pref: 100, description: 'Branch management' },
      { prefix: 'fabric.github.security', local_pref: 100, description: 'Security alerts and scanning' },
      { prefix: 'fabric.github.actions',  local_pref: 100, description: 'GitHub Actions workflows' },
      { prefix: 'fabric.github.prs',      local_pref: 100, description: 'Pull request management' },
    ],
  });

  console.log(`  Session token: ${regResp.data.session_token}`);
  console.log(`  Routes accepted: ${regResp.data.routes_accepted}`);
  console.log(`  Peer count: ${regResp.data.peer_count}`);

  // 3. Verify F-RIB
  console.log('\n3. F-RIB state:');
  const frib = await axios.get(`${GATEWAY}/frib`);
  console.log(`  Routes: ${frib.data.routes.length}`);
  console.log(`  Sessions: ${frib.data.sessions.length}`);
  for (const route of frib.data.routes) {
    console.log(`    ${route.prefix} → ${route.fabric_id} AS${route.as_number} pref=${route.local_pref} health=${route.worker_health}`);
  }

  // 4. Send test queries through the interceptor
  console.log('\n4. Routing tests:\n');

  const tests = [
    { query: 'list repos in git-fabric org',         domain: 'fabric.github.repos',   expect: 'local' },
    { query: 'show me security alerts for sdk repo',  domain: 'fabric.github.security', expect: 'local' },
    { query: 'list branches in git-fabric/sdk',       domain: 'fabric.github.branches', expect: 'local' },
    { query: 'list pull requests in git-fabric/sdk',  domain: 'fabric.github.prs',      expect: 'local' },
    { query: 'what is the meaning of life',            domain: undefined,                expect: 'claude' },
    { query: 'deploy kubernetes cluster',              domain: 'fabric.k8s',             expect: 'claude' },
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    try {
      const resp = await axios.post(`${GATEWAY}/intercept`, {
        query_text: test.query,
        domain_hint: test.domain,
        requestor_fabric_id: 'test-harness',
      });

      const lane = resp.data.lane;
      const conf = resp.data.confidence;
      const target = resp.data.target_fabric ?? 'claude';
      const isLocal = lane !== 'claude';
      const expectLocal = test.expect === 'local';
      const pass = isLocal === expectLocal;

      console.log(`  ${pass ? 'PASS' : 'FAIL'} | "${test.query}"`);
      console.log(`       lane=${lane} confidence=${conf?.toFixed(2) ?? '0.00'} target=${target}`);
      if (resp.data.context) {
        const preview = resp.data.context.substring(0, 100).replace(/\n/g, ' ');
        console.log(`       context: ${preview}...`);
      }
      console.log();

      if (pass) passed++; else failed++;
    } catch (err) {
      console.log(`  ERROR | "${test.query}": ${(err as Error).message}\n`);
      failed++;
    }
  }

  // 5. Check audit log
  console.log('5. Audit log (last 10):');
  const audit = await axios.get(`${GATEWAY}/audit?limit=10`);
  for (const entry of audit.data.entries) {
    console.log(`  ${entry.event_type} | fabric=${entry.fabric_id ?? '-'} | ${entry.decision ?? ''}`);
  }

  // 6. Summary
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);

  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
