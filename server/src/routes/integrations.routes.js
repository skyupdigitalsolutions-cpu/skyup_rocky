import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { Integration, PROVIDERS } from '../models/Integration.js';
import { Client } from '../models/Client.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission, canAccessClient } from '../middleware/rbac.js';
import { PERMISSIONS } from '../config/rbac.js';
import { asyncHandler, HttpError } from '../middleware/error.js';
import { audit } from '../middleware/audit.js';
import { getConnector, runSync } from '../connectors/index.js';
import { encryptSecret } from '../lib/crypto.js';
import { env, isProd } from '../config/env.js';
import { syncClient } from '../jobs/syncMetrics.js';

const router = Router();

// Sign short-lived OAuth state so client+provider survive the round-trip safely.
const signState = (payload) => jwt.sign(payload, env.JWT_SECRET, { expiresIn: '15m' });
const readState = (state) => jwt.verify(state, env.JWT_SECRET);

// ---- Authenticated management endpoints -------------------------------------
router.get(
  '/:clientId',
  requireAuth,
  requirePermission(PERMISSIONS.INTEGRATION_READ),
  asyncHandler(async (req, res) => {
    if (!canAccessClient(req.user, req.params.clientId)) throw new HttpError(403, 'Client not in your scope');
    const rows = await Integration.find({ client: req.params.clientId });
    const existing = Object.fromEntries(rows.map((r) => [r.provider, r.toPublicJSON()]));
    const list = PROVIDERS.map(
      (p) =>
        existing[p] || {
          provider: p,
          status: 'not_connected',
          configured: getConnector(p).isConfigured(),
        }
    ).map((row) => ({ ...row, configured: getConnector(row.provider).isConfigured() }));
    res.json({ integrations: list });
  })
);

// Begin connect: returns an OAuth authUrl. In non-prod, ?simulate=1 marks the
// integration connected without real creds so flows are testable offline.
router.post(
  '/:clientId/:provider/connect',
  requireAuth,
  requirePermission(PERMISSIONS.INTEGRATION_WRITE),
  asyncHandler(async (req, res) => {
    const { clientId, provider } = req.params;
    if (!PROVIDERS.includes(provider)) throw new HttpError(400, 'Unknown provider');
    if (!canAccessClient(req.user, clientId)) throw new HttpError(403, 'Client not in your scope');
    const connector = getConnector(provider);

    if (!isProd && req.query.simulate === '1') {
      await Integration.findOneAndUpdate(
        { client: clientId, provider },
        { status: 'connected', accountLabel: `${provider} (simulated)`, connectedBy: req.user._id, lastError: '' },
        { upsert: true, new: true }
      );
      await audit(req, 'integration.connect', { targetType: 'integration', targetId: `${clientId}:${provider}`, meta: { simulated: true } });
      return res.json({ ok: true, simulated: true });
    }

    if (!connector.isConfigured()) {
      throw new HttpError(400, `${provider} is not configured — add its API credentials in the server .env`);
    }
    const state = signState({ clientId, provider, uid: String(req.user._id) });
    res.json({ authUrl: connector.buildAuthUrl(await Client.findById(clientId), state) });
  })
);

// Trigger a manual read-only sync.
router.post(
  '/:clientId/:provider/sync',
  requireAuth,
  requirePermission(PERMISSIONS.INTEGRATION_WRITE),
  asyncHandler(async (req, res) => {
    const { clientId, provider } = req.params;
    if (!canAccessClient(req.user, clientId)) throw new HttpError(403, 'Client not in your scope');
    const client = await Client.findById(clientId);
    if (!client) throw new HttpError(404, 'Client not found');
    const result = await runSync(client, provider);
    await audit(req, 'integration.sync', { targetType: 'integration', targetId: `${clientId}:${provider}` });
    res.json({ result });
  })
);

router.post(
  '/:clientId/sync-all',
  requireAuth,
  requirePermission(PERMISSIONS.INTEGRATION_WRITE),
  asyncHandler(async (req, res) => {
    const client = await Client.findById(req.params.clientId);
    if (!client) throw new HttpError(404, 'Client not found');
    if (!canAccessClient(req.user, client._id)) throw new HttpError(403, 'Client not in your scope');
    const results = await syncClient(client);
    res.json({ results });
  })
);

router.post(
  '/:clientId/:provider/disconnect',
  requireAuth,
  requirePermission(PERMISSIONS.INTEGRATION_WRITE),
  asyncHandler(async (req, res) => {
    const { clientId, provider } = req.params;
    if (!canAccessClient(req.user, clientId)) throw new HttpError(403, 'Client not in your scope');
    await Integration.findOneAndUpdate(
      { client: clientId, provider },
      { status: 'revoked', credentials: {}, lastError: '' }
    );
    await audit(req, 'integration.disconnect', { targetType: 'integration', targetId: `${clientId}:${provider}` });
    res.json({ ok: true });
  })
);

// ---- OAuth callbacks (public; validated via signed state) -------------------
async function handleCallback(provider, req, res) {
  const { code, state, error } = req.query;
  const redirectBack = `${env.CLIENT_ORIGIN}/integrations/select`;
  if (error) return res.redirect(`${redirectBack}?connect=denied`);
  let claims;
  try {
    claims = readState(state);
  } catch {
    return res.redirect(`${redirectBack}?connect=badstate`);
  }
  try {
    const connector = getConnector(claims.provider);
    const result = await connector.exchangeCode(code, await Client.findById(claims.clientId));
    const encrypted = {};
    for (const [k, v] of Object.entries(result.credentials || {})) {
      if (v) encrypted[k] = encryptSecret(v);
    }
    await Integration.findOneAndUpdate(
      { client: claims.clientId, provider: claims.provider },
      {
        status: 'connected',
        credentials: encrypted,
        accountLabel: result.accountLabel,
        externalAccountId: result.externalAccountId,
        scopes: result.scopes,
        connectedBy: claims.uid,
        lastError: '',
      },
      { upsert: true }
    );
    return res.redirect(`${redirectBack}?connect=success&provider=${claims.provider}`);
  } catch (err) {
    return res.redirect(`${redirectBack}?connect=error&message=${encodeURIComponent(err.message)}`);
  }
}

router.get('/meta/callback', asyncHandler((req, res) => handleCallback('meta', req, res)));
router.get('/google-ads/callback', asyncHandler((req, res) => handleCallback('google_ads', req, res)));
router.get('/google/callback', asyncHandler((req, res) => handleCallback('google', req, res)));
router.get('/instagram/callback', asyncHandler((req, res) => handleCallback('instagram', req, res)));

export default router;
