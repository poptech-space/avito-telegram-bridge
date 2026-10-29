#!/usr/bin/env node
// Read-only health probe. Explicit URL, no account lookup, no webhook POST.
async function main() {
  const url = new URL(process.argv[2] || '');
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
    throw new Error('explicit_clean_https_health_url_required');
  const response = await fetch(url, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(5000) });
  const body = await response.json();
  if (!response.ok || body.ok !== true || body.service !== 'avito-bridge') throw new Error('health_failed');
  console.log('Health endpoint responds. Storage, worker and message delivery are not verified.');
}
main().catch(() => { console.error('Health probe refused or failed; provide an explicit HTTPS health URL without secrets.'); process.exitCode = 1; });
