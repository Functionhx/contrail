// Contrail：公开页面只展示真实数据，不提供上游的 ?mock=1 假数据模式。
export function isMockEnabled() {
  return false;
}
