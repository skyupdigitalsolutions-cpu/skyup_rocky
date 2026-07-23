// Contract every connector adapter implements. V1 is READ-ONLY: no adapter may
// expose a write/mutate method. Adapters normalize into MetricSnapshot rows so
// the orchestrator reads a single shape regardless of source (PRD 3.3/3.4/15).
//
// interface Connector {
//   provider: string                       // matches Integration.provider
//   isConfigured(): boolean                // are app-level API creds present in env?
//   buildAuthUrl(client, state): string    // OAuth consent URL (throws if unconfigured)
//   exchangeCode(code, client): Promise<{ credentials, accountLabel, externalAccountId, scopes }>
//   sync(client, integration, opts): Promise<{ ok, snapshots, reason }>
// }

export class ConnectorError extends Error {
  constructor(message, { code = 'connector_error' } = {}) {
    super(message);
    this.code = code;
  }
}

// Helper so adapters fail uniformly when creds are missing.
export function notConfigured(provider) {
  return {
    ok: false,
    snapshots: 0,
    reason: 'not_configured',
    message: `${provider} is not configured — add its API credentials in .env`,
  };
}
