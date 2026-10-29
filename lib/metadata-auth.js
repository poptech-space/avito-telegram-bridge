// Refresh instead of pinning the first short-lived IAM token into a cached driver.
function createAuthService(env, fetchToken = globalThis.fetch, clock = Date.now) {
  const { TokenAuthService } = require('ydb-sdk');
  if (env.IAM_TOKEN) return new TokenAuthService(env.IAM_TOKEN); // local migration only
  let cached, pending;
  return { async getAuthMetadata() {
    if (!cached || cached.until - clock() < 60000) {
      pending ||= (async () => {
        const response = await fetchToken('http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/token',
          { headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(1500) });
        if (!response.ok) throw new Error('metadata_auth_unavailable');
        const data = await response.json();
        if (typeof data.access_token !== 'string' || !data.access_token || !Number.isFinite(data.expires_in) || data.expires_in <= 60)
          throw new Error('metadata_auth_invalid');
        cached = { token: data.access_token, until: clock() + data.expires_in * 1000 };
      })().finally(() => { pending = null; });
      await pending;
    }
    return new TokenAuthService(cached.token).getAuthMetadata();
  } };
}
module.exports = { createAuthService };
