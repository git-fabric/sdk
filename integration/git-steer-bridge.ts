// git-steer-bridge.ts
// Standalone HTTP bridge that wraps raw GitHub API calls in the same
// tool-routing pattern as git-steer's FabricApp. No import of git-steer
// needed — uses Octokit directly via fetch.
//
// The gateway's DNS resolver calls POST /tools/call with
// { name: 'aiana_query', arguments: { query_text, top_k } }

import { createServer } from 'http';

const PORT = parseInt(process.env.BRIDGE_PORT ?? '8200', 10);
const GITHUB_TOKEN = process.env.GITHUB_TOKEN ?? process.env.GIT_STEER_TOKEN ?? '';

if (!GITHUB_TOKEN) {
  console.error('[bridge] GITHUB_TOKEN or GIT_STEER_TOKEN required');
  process.exit(1);
}

const GH_HEADERS = {
  Authorization: `token ${GITHUB_TOKEN}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'fabric-sdk/git-steer-bridge',
};

// Tool definitions — match git-steer's FabricApp
interface ToolDef {
  name: string;
  description: string;
  keywords: string[];
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

const tools: ToolDef[] = [
  {
    name: 'git_steer_repo_list',
    description: 'List GitHub repositories',
    keywords: ['list repo', 'repos', 'repositories', 'show repo'],
    execute: async (args) => {
      const org = args.org as string | undefined;
      const url = org
        ? `https://api.github.com/orgs/${encodeURIComponent(org)}/repos?per_page=100&sort=pushed`
        : 'https://api.github.com/user/repos?per_page=100&sort=pushed';
      const res = await fetch(url, { headers: GH_HEADERS });
      if (!res.ok) throw new Error(`GitHub API: ${res.status}`);
      const data = await res.json() as any[];
      return data.filter((r: any) => !r.archived).map((r: any) => ({
        fullName: r.full_name, name: r.name, owner: r.owner?.login,
        private: r.private, defaultBranch: r.default_branch,
        url: r.html_url, pushedAt: r.pushed_at,
      }));
    },
  },
  {
    name: 'git_steer_branch_list',
    description: 'List branches in a repository',
    keywords: ['branch', 'branches', 'list branch'],
    execute: async (args) => {
      const { owner, repo } = args as { owner: string; repo: string };
      if (!owner || !repo) throw new Error('owner and repo required');
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/branches?per_page=100`, { headers: GH_HEADERS });
      if (!res.ok) throw new Error(`GitHub API: ${res.status}`);
      const data = await res.json() as any[];
      return data.map((b: any) => ({ name: b.name, sha: b.commit.sha, protected: b.protected }));
    },
  },
  {
    name: 'git_steer_security_alerts',
    description: 'Get Dependabot security alerts',
    keywords: ['security alert', 'vulnerability', 'cve', 'dependabot', 'security'],
    execute: async (args) => {
      const { owner, repo } = args as { owner: string; repo: string };
      if (!owner || !repo) throw new Error('owner and repo required');
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/dependabot/alerts?state=open&per_page=100`, { headers: GH_HEADERS });
      if (!res.ok) throw new Error(`GitHub API: ${res.status}`);
      const data = await res.json() as any[];
      return { count: data.length, alerts: data.map((a: any) => ({
        number: a.number,
        severity: a.security_advisory?.severity ?? 'unknown',
        package: a.dependency?.package?.name ?? 'unknown',
        summary: a.security_advisory?.summary ?? '',
      }))};
    },
  },
  {
    name: 'git_steer_actions_workflows',
    description: 'List GitHub Actions workflows',
    keywords: ['workflow', 'actions', 'ci', 'pipeline'],
    execute: async (args) => {
      const { owner, repo } = args as { owner: string; repo: string };
      if (!owner || !repo) throw new Error('owner and repo required');
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/workflows`, { headers: GH_HEADERS });
      if (!res.ok) throw new Error(`GitHub API: ${res.status}`);
      const data = await res.json() as any;
      return data.workflows.map((w: any) => ({ id: w.id, name: w.name, path: w.path, state: w.state }));
    },
  },
  {
    name: 'git_steer_pr_list',
    description: 'List pull requests',
    keywords: ['pull request', 'pr list', 'prs', 'pull requests'],
    execute: async (args) => {
      const { owner, repo } = args as { owner: string; repo: string };
      if (!owner || !repo) throw new Error('owner and repo required');
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls?state=open&per_page=50`, { headers: GH_HEADERS });
      if (!res.ok) throw new Error(`GitHub API: ${res.status}`);
      const data = await res.json() as any[];
      return data.map((pr: any) => ({
        number: pr.number, title: pr.title,
        state: pr.merged_at ? 'merged' : pr.state,
        author: pr.user?.login, head: pr.head.ref, base: pr.base.ref,
      }));
    },
  },
  {
    name: 'git_steer_repo_list_files',
    description: 'List files in a repository',
    keywords: ['list file', 'directory', 'ls', 'files'],
    execute: async (args) => {
      const { owner, repo } = args as { owner: string; repo: string };
      const path = (args.path as string) ?? '';
      if (!owner || !repo) throw new Error('owner and repo required');
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, { headers: GH_HEADERS });
      if (!res.ok) throw new Error(`GitHub API: ${res.status}`);
      const data = await res.json() as any[];
      if (!Array.isArray(data)) return [];
      return data.map((f: any) => ({ name: f.name, path: f.path, type: f.type, size: f.size }));
    },
  },
];

function matchQuery(queryText: string): { tool: ToolDef; confidence: number } | null {
  const lower = queryText.toLowerCase();
  let best: { tool: ToolDef; score: number } | null = null;

  for (const tool of tools) {
    let score = 0;
    for (const kw of tool.keywords) {
      if (lower.includes(kw)) {
        score += kw.split(' ').length;
      }
    }
    if (score > 0 && (!best || score > best.score)) {
      best = { tool, score };
    }
  }

  if (!best) return null;
  return { tool: best.tool, confidence: Math.min(best.score / 2, 1.0) };
}

function extractArgs(queryText: string): Record<string, unknown> {
  const args: Record<string, unknown> = {};

  // Extract "owner/repo" patterns
  const repoMatch = queryText.match(/\b([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_.-]+)\b/);
  if (repoMatch) {
    args.owner = repoMatch[1];
    args.repo = repoMatch[2];
  }

  // Extract "in <org>" or "in the <org> org"
  const orgMatch = queryText.match(/\bin\s+(?:the\s+)?([a-zA-Z0-9_-]+)(?:\s+org)?/i);
  if (orgMatch && !args.org) {
    args.org = orgMatch[1];
  }

  return args;
}

const server = createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ app: 'git-steer-bridge', status: 'healthy', tools: tools.length }));
    return;
  }

  if (req.method === 'GET' && req.url === '/tools') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ tools: tools.map(t => ({ name: t.name, description: t.description })) }));
    return;
  }

  if (req.method === 'POST' && req.url === '/tools/call') {
    let body = '';
    for await (const chunk of req) body += chunk;

    try {
      const payload = JSON.parse(body) as {
        name: string;
        arguments: { query_text: string; top_k?: number };
      };

      if (payload.name === 'aiana_query') {
        const queryText = payload.arguments.query_text;
        const match = matchQuery(queryText);

        if (!match) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ context: null, confidence: 0 }));
          return;
        }

        console.log(`[bridge] "${queryText}" -> ${match.tool.name} (${match.confidence.toFixed(2)})`);

        try {
          const args = extractArgs(queryText);
          console.log(`[bridge] args:`, JSON.stringify(args));
          const result = await match.tool.execute(args);
          const context = JSON.stringify(result, null, 2);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ context, confidence: match.confidence, tool_used: match.tool.name }));
        } catch (err) {
          console.error(`[bridge] ${(err as Error).message}`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            context: `Tool ${match.tool.name} matched but failed: ${(err as Error).message}`,
            confidence: match.confidence * 0.5,
            tool_used: match.tool.name,
          }));
        }
        return;
      }

      // Direct tool call
      const tool = tools.find(t => t.name === payload.name);
      if (!tool) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Tool not found: ${payload.name}` }));
        return;
      }

      const result = await tool.execute(payload.arguments);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));

    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`[bridge] git-steer bridge on :${PORT} — ${tools.length} tools`);
});
