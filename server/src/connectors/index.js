import { metaConnector } from './meta.js';
import { googleAdsConnector } from './googleAds.js';
import { searchConsoleConnector, ga4Connector } from './searchConsole.js';
import { instagramConnector } from './instagram.js';
import { Integration } from '../models/Integration.js';
import { MetricSnapshot } from '../models/MetricSnapshot.js';
import { decryptSecret } from '../lib/crypto.js';
import { logger } from '../lib/logger.js';

export const CONNECTORS = {
  meta: metaConnector,
  google_ads: googleAdsConnector,
  search_console: searchConsoleConnector,
  ga4: ga4Connector,
  instagram: instagramConnector,
};

export function getConnector(provider) {
  const c = CONNECTORS[provider];
  if (!c) throw new Error(`Unknown connector: ${provider}`);
  return c;
}

export async function runSync(client, provider) {
  const connector = getConnector(provider);
  const integration = await Integration.findOne({ client: client._id, provider }).select('+credentials');

  const getCredential = (name) => {
    const enc = integration?.credentials?.get?.(name);
    return enc ? decryptSecret(enc) : null;
  };

  let result;
  try {
    result = await connector.sync(client, integration, { getCredential });
  } catch (err) {
    logger.warn({ err: err.message }, `[sync] ${provider} failed for ${client.name}`);
    if (integration) {
      integration.status = 'error';
      integration.lastError = err.message?.slice(0, 300) || 'sync error';
      await integration.save();
    }
    return { ok: false, provider, reason: 'error', message: err.message };
  }

  if (result.ok && Array.isArray(result.snapshots) && result.snapshots.length) {
    await MetricSnapshot.insertMany(result.snapshots);
    result.snapshots = result.snapshots.length;
  }

  if (integration) {
    integration.lastSyncAt = new Date();
    integration.lastError = result.ok ? '' : result.message || '';
    if (result.reason === 'not_configured') integration.status = 'not_connected';
    else if (result.ok) integration.status = 'connected';
    await integration.save();
  }

  return { provider, ...result };
}