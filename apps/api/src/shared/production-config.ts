export function validateProductionConfig() {
  if (process.env.NODE_ENV !== 'production') {
    return;
  }

  const required = ['JWT_SECRET', 'PUBLIC_SERVER_URL', 'CORS_ORIGIN'];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required production environment variables: ${missing.join(', ')}`);
  }

  if (process.env.JWT_SECRET === 'local-dev-secret' || String(process.env.JWT_SECRET).length < 24) {
    throw new Error('JWT_SECRET must be a strong production secret with at least 24 characters.');
  }

  const publicServerUrl = String(process.env.PUBLIC_SERVER_URL);
  if (publicServerUrl.includes('localhost') || publicServerUrl.includes('127.0.0.1')) {
    throw new Error('PUBLIC_SERVER_URL must be a LAN IP or public domain in production, not localhost.');
  }
}
