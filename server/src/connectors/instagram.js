import { env } from '../config/env.js';
import { ConnectorError } from './base.js';

// Instagram Graph connector.
//  - OAuth "Connect" flow: buildAuthUrl -> exchangeCode. exchangeCode turns the
//    login code into a LONG-LIVED (effectively permanent) Page token and resolves
//    the linked Instagram business account, so tokens never need manual refresh.
//  - Publishing surface: createReelContainer -> poll status -> publishContainer.
//  - sync() is a no-op (this is a publishing channel, not a metrics source).

const GRAPH = () => `https://graph.facebook.com/${env.META_API_VERSION}`;
const REDIRECT = () => `${env.SERVER_PUBLIC_URL}/api/integrations/instagram/callback`;

const SCOPES = [
  'instagram_basic',
  'instagram_content_publish',
  'instagram_manage_insights',
  'pages_show_list',
  'pages_read_engagement',
  'business_management',
];

export const instagramConnector = {
  provider: 'instagram',

  isConfigured() {
    return Boolean(env.META_APP_ID && env.META_APP_SECRET);
  },

  buildAuthUrl(client, state) {
    if (!this.isConfigured()) throw new ConnectorError('Instagram not configured', { code: 'not_configured' });
    const url = new URL(`https://www.facebook.com/${env.META_API_VERSION}/dialog/oauth`);
    url.searchParams.set('client_id', env.META_APP_ID);
    url.searchParams.set('redirect_uri', REDIRECT());
    url.searchParams.set('scope', SCOPES.join(','));
    url.searchParams.set('state', state);
    url.searchParams.set('response_type', 'code');
    return url.toString();
  },

  // code -> short user token -> long-lived user token -> permanent Page token.
  async exchangeCode(code, client) {
    if (!this.isConfigured()) throw new ConnectorError('Instagram not configured', { code: 'not_configured' });

    // 1) code -> short-lived user token
    const t1 = new URL(`${GRAPH()}/oauth/access_token`);
    t1.searchParams.set('client_id', env.META_APP_ID);
    t1.searchParams.set('client_secret', env.META_APP_SECRET);
    t1.searchParams.set('redirect_uri', REDIRECT());
    t1.searchParams.set('code', code);
    const r1 = await fetch(t1);
    const d1 = await r1.json();
    if (!r1.ok) throw new ConnectorError(`Token exchange failed: ${JSON.stringify(d1?.error || d1)}`);

    // 2) short -> long-lived user token (~60d); Page tokens from it don't expire
    const t2 = new URL(`${GRAPH()}/oauth/access_token`);
    t2.searchParams.set('grant_type', 'fb_exchange_token');
    t2.searchParams.set('client_id', env.META_APP_ID);
    t2.searchParams.set('client_secret', env.META_APP_SECRET);
    t2.searchParams.set('fb_exchange_token', d1.access_token);
    const r2 = await fetch(t2);
    const d2 = await r2.json();
    const longUserToken = r2.ok && d2.access_token ? d2.access_token : d1.access_token;

    // 3) list pages + their linked IG business account (Page token is permanent)
    const acc = new URL(`${GRAPH()}/me/accounts`);
    acc.searchParams.set('fields', 'name,access_token,instagram_business_account{id,username}');
    acc.searchParams.set('access_token', longUserToken);
    const r3 = await fetch(acc);
    const d3 = await r3.json();
    if (!r3.ok) throw new ConnectorError(`Could not list Pages: ${JSON.stringify(d3?.error || d3)}`);
    const pages = d3.data || [];
    if (!pages.length) {
      throw new ConnectorError('No Pages available for this account. Make sure your user has full control of the Page and Instagram account in Business settings.');
    }

    // Prefer the page whose IG account matches the client's stored id; else the
    // first page that has an Instagram business account linked.
    const wantIg = client?.accountRefs?.instagramUserId;
    const page =
      (wantIg && pages.find((p) => p.instagram_business_account?.id === wantIg)) ||
      pages.find((p) => p.instagram_business_account?.id) ||
      pages[0];

    const igId = page.instagram_business_account?.id;
    const igUser = page.instagram_business_account?.username;
    if (!igId) {
      throw new ConnectorError(`Page "${page.name}" has no linked Instagram business account. Link the IG account to the Page in Business settings.`);
    }

    // Persist the resolved IG id on the client so the publisher can target it.
    if (client) {
      client.accountRefs = { ...(client.accountRefs || {}), instagramUserId: igId };
      try { await client.save(); } catch { /* non-fatal */ }
    }

    return {
      credentials: { accessToken: page.access_token }, // permanent Page token
      accountLabel: igUser ? `@${igUser}` : page.name,
      externalAccountId: igId,
      scopes: SCOPES,
    };
  },

  async sync() {
    return { ok: true, snapshots: 0, reason: 'no_metric_sync', message: 'Instagram is a publishing channel (no metrics sync).' };
  },

  // ---- Publishing surface (used by services/reelsPublisher.js) --------------

  async createReelContainer({ igUserId, token, videoUrl, caption }) {
    const url = new URL(`${GRAPH()}/${igUserId}/media`);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ media_type: 'REELS', video_url: videoUrl, caption: caption || '', access_token: token }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ConnectorError(`IG container create failed: ${res.status} ${JSON.stringify(data?.error || data)}`);
    return data.id;
  },

  async getContainerStatus({ containerId, token }) {
    const url = new URL(`${GRAPH()}/${containerId}`);
    url.searchParams.set('fields', 'status_code,status');
    url.searchParams.set('access_token', token);
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ConnectorError(`IG container status failed: ${res.status}`);
    return data.status_code;
  },

  async publishContainer({ igUserId, token, containerId }) {
    const url = new URL(`${GRAPH()}/${igUserId}/media_publish`);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ creation_id: containerId, access_token: token }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ConnectorError(`IG publish failed: ${res.status} ${JSON.stringify(data?.error || data)}`);
    return data.id;
  },

  async getPermalink({ mediaId, token }) {
    try {
      const url = new URL(`${GRAPH()}/${mediaId}`);
      url.searchParams.set('fields', 'permalink');
      url.searchParams.set('access_token', token);
      const res = await fetch(url);
      const data = await res.json().catch(() => ({}));
      return res.ok ? data.permalink || '' : '';
    } catch {
      return '';
    }
  },
};
