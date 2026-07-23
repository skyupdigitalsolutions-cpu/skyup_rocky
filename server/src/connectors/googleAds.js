import { env } from '../config/env.js';
import { notConfigured, ConnectorError } from './base.js';

// Google Ads API (read-only). Requires a Developer Token + OAuth client.
export const googleAdsConnector = {
  provider: 'google_ads',

  isConfigured() {
    return Boolean(
      env.GOOGLE_ADS_DEVELOPER_TOKEN && env.GOOGLE_ADS_CLIENT_ID && env.GOOGLE_ADS_CLIENT_SECRET
    );
  },

  buildAuthUrl(client, state) {
    if (!this.isConfigured()) throw new ConnectorError('Google Ads not configured', { code: 'not_configured' });
    const redirect = `${env.SERVER_PUBLIC_URL}/api/integrations/google-ads/callback`;
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', env.GOOGLE_ADS_CLIENT_ID);
    url.searchParams.set('redirect_uri', redirect);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set('scope', 'https://www.googleapis.com/auth/adwords');
    url.searchParams.set('state', state);
    return url.toString();
  },

  async exchangeCode(code) {
    if (!this.isConfigured()) throw new ConnectorError('Google Ads not configured', { code: 'not_configured' });
    const redirect = `${env.SERVER_PUBLIC_URL}/api/integrations/google-ads/callback`;
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_ADS_CLIENT_ID,
        client_secret: env.GOOGLE_ADS_CLIENT_SECRET,
        redirect_uri: redirect,
        grant_type: 'authorization_code',
      }),
    });
    if (!res.ok) throw new ConnectorError(`Google Ads token exchange failed: ${res.status}`);
    const data = await res.json();
    return {
      credentials: { accessToken: data.access_token, refreshToken: data.refresh_token },
      accountLabel: 'Google Ads',
      externalAccountId: '',
      scopes: ['adwords.readonly'],
    };
  },

  async sync(client, integration, { getCredential }) {
    if (!this.isConfigured()) return notConfigured('Google Ads');
    const refresh = getCredential('refreshToken');
    if (!refresh) return notConfigured('Google Ads');
    const customerId = client.accountRefs?.googleAdsCustomerId;
    if (!customerId) {
      return { ok: false, snapshots: 0, reason: 'missing_account', message: 'No Google Ads customer id on this client' };
    }
    // TODO(real): use refresh token -> access token, then GAQL via
    //   POST customers/{id}/googleAds:searchStream with a metrics query
    //   (metrics.cost_micros, impressions, clicks, ctr, average_cpc, conversions...).
    // Normalize each campaign row into a MetricSnapshot { source:'google_ads', ... }.
    return { ok: true, snapshots: 0, reason: 'no_data_yet', message: 'Connected; awaiting first metric query implementation.' };
  },
};
