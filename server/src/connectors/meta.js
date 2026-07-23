import { env } from '../config/env.js';
import { notConfigured, ConnectorError } from './base.js';

// Meta Marketing API (read-only). Real network calls are wired but gated behind
// configured credentials; until META_APP_ID/SECRET + a connected token exist,
// sync() reports not_configured and Rocky states what's missing (no fabrication).
export const metaConnector = {
  provider: 'meta',

  isConfigured() {
    return Boolean(env.META_APP_ID && env.META_APP_SECRET);
  },

  buildAuthUrl(client, state) {
    if (!this.isConfigured()) throw new ConnectorError('Meta not configured', { code: 'not_configured' });
    const redirect = `${env.SERVER_PUBLIC_URL}/api/integrations/meta/callback`;
    const scope = ['ads_read', 'business_management'].join(',');
    const url = new URL(`https://www.facebook.com/${env.META_API_VERSION}/dialog/oauth`);
    url.searchParams.set('client_id', env.META_APP_ID);
    url.searchParams.set('redirect_uri', redirect);
    url.searchParams.set('scope', scope);
    url.searchParams.set('state', state);
    url.searchParams.set('response_type', 'code');
    return url.toString();
  },

  async exchangeCode(code /*, client */) {
    if (!this.isConfigured()) throw new ConnectorError('Meta not configured', { code: 'not_configured' });
    const redirect = `${env.SERVER_PUBLIC_URL}/api/integrations/meta/callback`;
    const tokenUrl = new URL(`https://graph.facebook.com/${env.META_API_VERSION}/oauth/access_token`);
    tokenUrl.searchParams.set('client_id', env.META_APP_ID);
    tokenUrl.searchParams.set('client_secret', env.META_APP_SECRET);
    tokenUrl.searchParams.set('redirect_uri', redirect);
    tokenUrl.searchParams.set('code', code);

    const res = await fetch(tokenUrl);
    if (!res.ok) throw new ConnectorError(`Meta token exchange failed: ${res.status}`);
    const data = await res.json();
    return {
      credentials: { accessToken: data.access_token },
      accountLabel: 'Meta Ads',
      externalAccountId: '',
      scopes: ['ads_read'],
    };
  },

  // Read-only sync. `getCredential(name)` decrypts a stored secret for this client.
  async sync(client, integration, { getCredential, since }) {
    if (!this.isConfigured()) return notConfigured('Meta Ads');
    const token = getCredential('accessToken');
    if (!token) return notConfigured('Meta Ads');

    const adAccountId = client.accountRefs?.metaAdAccountId;
    if (!adAccountId) {
      return { ok: false, snapshots: 0, reason: 'missing_account', message: 'No Meta ad account id set on this client' };
    }

    // TODO(real): GET /{ad-account}/insights?level=campaign&fields=spend,impressions,
    //   reach,clicks,ctr,cpc,cpm,actions,cost_per_action_type&time_range=...
    // Map each row into a MetricSnapshot { source:'meta', level:'campaign', metrics:{...} }.
    // Left as an explicit integration point; not fabricating rows here.
    const url = new URL(`https://graph.facebook.com/${env.META_API_VERSION}/act_${adAccountId}/insights`);
    url.searchParams.set('level', 'campaign');
    url.searchParams.set(
      'fields',
      'campaign_name,spend,impressions,reach,clicks,ctr,cpc,cpm,actions,cost_per_action_type'
    );
    url.searchParams.set('date_preset', since ? 'last_7d' : 'last_7d');
    url.searchParams.set('access_token', token);

    const res = await fetch(url);
    if (!res.ok) throw new ConnectorError(`Meta insights failed: ${res.status}`);
    const data = await res.json();
    const snapshots = normalizeMetaInsights(client, data?.data || []);
    return { ok: true, snapshots };
  },
};

// Pure mapping helper (exported for unit tests / seed reuse).
export function normalizeMetaInsights(client, rows) {
  const now = new Date();
  const start = new Date(now.getTime() - 7 * 864e5);
  return rows.map((r) => ({
    client: client._id,
    source: 'meta',
    level: 'campaign',
    entityId: r.campaign_id || '',
    entityName: r.campaign_name || '',
    periodStart: start,
    periodEnd: now,
    metrics: {
      spend: num(r.spend),
      impressions: num(r.impressions),
      reach: num(r.reach),
      clicks: num(r.clicks),
      ctr: num(r.ctr),
      cpc: num(r.cpc),
      cpm: num(r.cpm),
      conversions: sumActions(r.actions),
    },
  }));
}

const num = (v) => (v == null ? undefined : Number(v));
const sumActions = (actions) =>
  Array.isArray(actions) ? actions.reduce((s, a) => s + Number(a.value || 0), 0) : undefined;
