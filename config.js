// GitHub Actions 远程触发配置
// PAT 在这里粘贴：fine-grained，only actions:write on this repo
// 暴露给前端是设计 — 万一被偷了，最坏只能触发 workflow（数据本来就公开）
const REFRESH_CONFIG = {
  GITHUB_PAT: '',  // ← 在这里粘贴 PAT，比如 'github_pat_xxxxxxxxxxxx'
  REPO: 'eightnrcn2025-create/commercial-dashboard-2026-05',
  WORKFLOW_FILE: 'refresh.yml',
};
