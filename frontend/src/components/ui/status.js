export function noteStatusTone(status) {
  return ({ 진행중: 'info', 검토요청: 'warning', 승인대기: 'warning', 승인됨: 'success', 반려: 'danger' })[status] || 'neutral';
}
