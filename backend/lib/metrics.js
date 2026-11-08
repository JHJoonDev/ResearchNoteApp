const requests = new Map();
export function recordRequest(method, status) {
  const key = `${method}|${status}`;
  requests.set(key, (requests.get(key) || 0) + 1);
}
export function prometheusText() {
  const lines = ['# HELP labhub_http_requests_total Total HTTP requests handled by LabHub.', '# TYPE labhub_http_requests_total counter'];
  for (const [key, value] of requests) {
    const [method, status] = key.split('|');
    lines.push(`labhub_http_requests_total{method="${method}",status="${status}"} ${value}`);
  }
  lines.push('# HELP labhub_process_uptime_seconds Process uptime in seconds.', '# TYPE labhub_process_uptime_seconds gauge');
  lines.push(`labhub_process_uptime_seconds ${Math.floor(process.uptime())}`);
  lines.push('# HELP labhub_process_heap_used_bytes Process heap currently used in bytes.', '# TYPE labhub_process_heap_used_bytes gauge');
  lines.push(`labhub_process_heap_used_bytes ${process.memoryUsage().heapUsed}`);
  return `${lines.join('\n')}\n`;
}
