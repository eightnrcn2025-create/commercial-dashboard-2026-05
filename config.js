// GitHub Actions 远程触发配置
// PAT 存到 Cloudflare Worker 的 Secret 里（env.GITHUB_PAT），前端只调 Worker URL
const REFRESH_CONFIG = {
  WORKER_URL: 'https://dashboard-refresh.eight-nrcn-2025.workers.dev',
};
