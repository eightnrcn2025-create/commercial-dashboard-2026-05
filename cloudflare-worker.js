// Cloudflare Worker — 中转触发 GitHub Actions
// PAT 存在 Worker 的 secret 里（env.GITHUB_PAT），不会泄露到前端
export default {
  async fetch(request, env) {
    // CORS 预检
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    const url = new URL(request.url);
    const REPO = 'eightnrcn2025-create/commercial-dashboard-2026-05';
    const WORKFLOW = 'refresh.yml';
    const corsHeaders = { 'Access-Control-Allow-Origin': '*' };

    if (url.pathname === '/dispatch') {
      const res = await fetch(
        `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.GITHUB_PAT}`,
            'Accept': 'application/vnd.github+json',
            'User-Agent': 'dashboard-refresh-worker',
            'X-GitHub-Api-Version': '2022-11-28',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ ref: 'main' }),
        }
      );
      return new Response(res.status === 204 ? 'OK' : `error ${res.status}`, {
        status: res.status === 204 ? 200 : 500,
        headers: corsHeaders,
      });
    }

    if (url.pathname === '/status') {
      const res = await fetch(
        `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/runs?per_page=1`,
        {
          headers: {
            'Authorization': `Bearer ${env.GITHUB_PAT}`,
            'Accept': 'application/vnd.github+json',
            'User-Agent': 'dashboard-refresh-worker',
            'X-GitHub-Api-Version': '2022-11-28',
          },
        }
      );
      const data = await res.json();
      const latest = data.workflow_runs?.[0];
      return new Response(JSON.stringify({
        status: latest?.status,
        conclusion: latest?.conclusion,
        created_at: latest?.created_at,
        id: latest?.id,
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response('dashboard-refresh worker. POST /dispatch or GET /status', {
      status: 200,
      headers: corsHeaders,
    });
  },
};
