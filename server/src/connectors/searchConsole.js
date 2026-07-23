import { env } from '../config/env.js';
import { notConfigured, ConnectorError } from './base.js';

const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/webmasters.readonly',
  'https://www.googleapis.com/auth/analytics.readonly',
];

function googleConfigured() {
  return Boolean(env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET);
}

function buildGoogleAuthUrl(state) {
  const redirect = `${env.SERVER_PUBLIC_URL}/api/integrations/google/callback`;
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', env.GOOGLE_OAUTH_CLIENT_ID);
  url.searchParams.set('redirect_uri', redirect);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('scope', GOOGLE_SCOPES.join(' '));
  url.searchParams.set('state', state);
  return url.toString();
}

async function exchangeGoogleCode(code) {
  const redirect = `${env.SERVER_PUBLIC_URL}/api/integrations/google/callback`;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      redirect_uri: redirect,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) throw new ConnectorError(`Google token exchange failed: ${res.status}`);
  return res.json();
}

// Google Search Console (read-only).
export const searchConsoleConnector = {
  provider: 'search_console',
  isConfigured: googleConfigured,
  buildAuthUrl(client, state) {
    if (!googleConfigured()) throw new ConnectorError('Google not configured', { code: 'not_configured' });
    return buildGoogleAuthUrl(state);
  },
  async exchangeCode(code) {
    const data = await exchangeGoogleCode(code);
    return {
      credentials: { accessToken: data.access_token, refreshToken: data.refresh_token },
      accountLabel: 'Search Console',
      externalAccountId: '',
      scopes: ['webmasters.readonly'],
    };
  },
  async sync(client, integration, { getCredential }) {
    if (!googleConfigured()) return notConfigured('Search Console');
    if (!getCredential('refreshToken')) return notConfigured('Search Console');
    const site = client.accountRefs?.gscSiteUrl;
    if (!site) return { ok: false, snapshots: 0, reason: 'missing_account', message: 'No GSC site url on this client' };
    // TODO(real): POST webmasters/v3/sites/{site}/searchAnalytics/query
    //   dimensions:[query|page], metrics: clicks, impressions, ctr, position.
    return { ok: true, snapshots: 0, reason: 'no_data_yet', message: 'Connected; awaiting Search Analytics query implementation.' };
  },
};

// GA4 (read-only) — shares the same Google OAuth grant.
export const ga4Connector = {
  provider: 'ga4',
  isConfigured: googleConfigured,
  buildAuthUrl(client, state) {
    if (!googleConfigured()) throw new ConnectorError('Google not configured', { code: 'not_configured' });
    return buildGoogleAuthUrl(state);
  },
  async exchangeCode(code) {
    const data = await exchangeGoogleCode(code);
    return {
      credentials: { accessToken: data.access_token, refreshToken: data.refresh_token },
      accountLabel: 'GA4',
      externalAccountId: '',
      scopes: ['analytics.readonly'],
    };
  },
  async sync(client, integration, { getCredential }) {
    if (!googleConfigured()) return notConfigured('GA4');
    if (!getCredential('refreshToken')) return notConfigured('GA4');
    const propertyId = client.accountRefs?.ga4PropertyId || env.GA4_DEFAULT_PROPERTY_ID;
    if (!propertyId) return { ok: false, snapshots: 0, reason: 'missing_account', message: 'No GA4 property id on this client' };
    // TODO(real): POST analyticsdata.googleapis.com/v1beta/properties/{id}:runReport
    //   metrics: sessions, engagedSessions, conversions; dimensions: date, landingPage.
    return { ok: true, snapshots: 0, reason: 'no_data_yet', message: 'Connected; awaiting runReport implementation.' };
  },
};
