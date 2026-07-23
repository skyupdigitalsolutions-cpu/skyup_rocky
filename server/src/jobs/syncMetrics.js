import { Client } from '../models/Client.js';
import { Integration } from '../models/Integration.js';
import { runSync } from '../connectors/index.js';
import { logger } from '../lib/logger.js';

// Sync all connected integrations across all clients. Safe to run on a schedule
// or trigger manually from the Integrations page. Read-only by design.
export async function syncAllMetrics() {
  const clients = await Client.find({ status: 'active' }).lean();
  const results = [];
  for (const client of clients) {
    const integrations = await Integration.find({ client: client._id, status: 'connected' }).lean();
    for (const integ of integrations) {
      const r = await runSync(client, integ.provider);
      results.push({ client: client.name, ...r });
    }
  }
  logger.info(`[sync] completed ${results.length} connector syncs`);
  return results;
}

export async function syncClient(client) {
  const integrations = await Integration.find({ client: client._id, status: 'connected' }).lean();
  const results = [];
  for (const integ of integrations) {
    results.push(await runSync(client, integ.provider));
  }
  return results;
}
