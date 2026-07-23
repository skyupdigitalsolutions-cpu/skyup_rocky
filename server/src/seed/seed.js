/**
 * ============================================================================
 * DEVELOPMENT SEED — CLEARLY-MARKED FIXTURES (PRD Section 15).
 * Populates a demo dataset so the whole app is usable offline with the mock
 * LLM + mock embeddings and ZERO external API keys. NEVER run against prod data.
 * Run: `npm run seed`
 * ============================================================================
 */
import mongoose from 'mongoose';
import { connectDb, disconnectDb } from '../config/db.js';
import { User } from '../models/User.js';
import { Client } from '../models/Client.js';
import { Integration } from '../models/Integration.js';
import { MetricSnapshot } from '../models/MetricSnapshot.js';
import { ROLES } from '../config/rbac.js';
import { ingestDocument } from '../rag/ingest.js';
import { Document } from '../models/Document.js';
import { logger } from '../lib/logger.js';

const DEMO_PASSWORD = 'RockyDemo#2026';

async function run() {
  await connectDb();
  logger.warn('[seed] wiping demo collections and reseeding fixtures');

  await Promise.all([
    User.deleteMany({}),
    Client.deleteMany({}),
    Integration.deleteMany({}),
    MetricSnapshot.deleteMany({}),
    Document.deleteMany({}),
    mongoose.connection.collection('documentchunks').deleteMany({}).catch(() => {}),
  ]);

  // --- Users -----------------------------------------------------------------
  const admin = new User({ name: 'Roshan (Admin)', email: 'admin@skyup.test', role: ROLES.ADMIN });
  await admin.setPassword(DEMO_PASSWORD);
  await admin.save();

  const member = new User({ name: 'Team Member', email: 'member@skyup.test', role: ROLES.MEMBER });
  await member.setPassword(DEMO_PASSWORD);
  await member.save();

  // --- Clients ---------------------------------------------------------------
  const acme = await Client.create({
    name: 'Acme Interiors',
    industry: 'Interior design',
    website: 'https://acme-interiors.example',
    status: 'active',
    goals: 'Increase qualified leads at a lower cost per lead.',
    targetMarket: 'Homeowners in Bengaluru, 30–55, mid-to-premium budgets.',
    brandNotes: 'Premium but approachable. Emphasize craftsmanship and turnaround time.',
    services: [
      { name: 'Meta Ads', status: 'active', monthlyBudget: 120000, notes: 'Lead gen campaigns' },
      { name: 'SEO', status: 'active', monthlyBudget: 40000 },
    ],
    contacts: [{ name: 'Priya', role: 'Marketing Head', email: 'priya@acme.example' }],
    accountRefs: { metaAdAccountId: '000000000000000', gscSiteUrl: 'https://acme-interiors.example/' },
    createdBy: admin._id,
  });

  const nova = await Client.create({
    name: 'Nova Fitness',
    industry: 'Fitness studio',
    website: 'https://novafitness.example',
    status: 'active',
    goals: 'Fill class memberships and grow brand search.',
    targetMarket: 'Young professionals near Indiranagar.',
    services: [{ name: 'Google Ads', status: 'active', monthlyBudget: 90000 }],
    accountRefs: { googleAdsCustomerId: '111-222-3333' },
    createdBy: admin._id,
  });

  // Assign the member to only one client (to demonstrate scoping).
  member.assignedClients = [acme._id];
  await member.save();

  // --- Simulated connected integrations --------------------------------------
  await Integration.create([
    { client: acme._id, provider: 'meta', status: 'connected', accountLabel: 'Meta Ads (demo)', connectedBy: admin._id, lastSyncAt: new Date() },
    { client: acme._id, provider: 'search_console', status: 'connected', accountLabel: 'Search Console (demo)', connectedBy: admin._id, lastSyncAt: new Date() },
    { client: nova._id, provider: 'google_ads', status: 'connected', accountLabel: 'Google Ads (demo)', connectedBy: admin._id, lastSyncAt: new Date() },
  ]);

  // --- Seeded metric snapshots (current + prior 7d) so comparisons work ------
  await MetricSnapshot.insertMany([
    ...campaignPair(acme._id, 'meta', 'Lead Gen — Kitchens', { spend: 62000, impressions: 480000, clicks: 5200, conversions: 78 }, { spend: 58000, impressions: 512000, clicks: 6100, conversions: 110 }),
    ...campaignPair(acme._id, 'meta', 'Lead Gen — Wardrobes', { spend: 41000, impressions: 300000, clicks: 3600, conversions: 51 }, { spend: 39000, impressions: 288000, clicks: 3400, conversions: 47 }),
    ...campaignPair(acme._id, 'search_console', 'organic', { impressions: 92000, clicks: 3100 }, { impressions: 88000, clicks: 3300 }),
    ...campaignPair(nova._id, 'google_ads', 'Brand — Search', { spend: 28000, impressions: 90000, clicks: 4200, conversions: 240 }, { spend: 26000, impressions: 84000, clicks: 3900, conversions: 250 }),
  ]);

  // --- One client document, ingested for RAG (works with mock embeddings) ----
  const doc = await Document.create({
    client: acme._id,
    title: 'Acme — Q3 Strategy Brief',
    kind: 'strategy',
    mimeType: 'text/plain',
    status: 'processing',
    uploadedBy: admin._id,
  });
  await ingestDocument(
    doc._id,
    `Acme Interiors Q3 Strategy Brief.

Primary objective: reduce cost per qualified lead by 20% while maintaining lead volume.
Key insight from Q2: kitchen remodel creatives outperformed wardrobe creatives on CTR but produced lower-intent leads. Sales flagged that "kitchens" leads needed heavier qualification.
Plan: shift 15% of Meta budget from broad prospecting to a retargeting audience of website visitors and past enquirers. Test a new "book a design consultation" CTA.
SEO: publish 4 location landing pages (Whitefield, Koramangala, HSR, Indiranagar) targeting "interior designers in <area>". Improve internal linking to the portfolio pages.
Watchouts: monsoon season historically slows enquiries in July–August; expect softer conversion volume and plan budget pacing accordingly.`
  );

  logger.info('[seed] done');
  logger.info(`[seed] Admin login:  admin@skyup.test  /  ${DEMO_PASSWORD}`);
  logger.info(`[seed] Member login: member@skyup.test /  ${DEMO_PASSWORD}  (scoped to Acme only)`);

  await disconnectDb();
  process.exit(0);
}

// Build a current + prior-period snapshot pair for a campaign.
function campaignPair(clientId, source, name, current, prior) {
  const now = new Date();
  const currStart = new Date(now.getTime() - 7 * 864e5);
  const prevEnd = new Date(currStart.getTime() - 1);
  const prevStart = new Date(currStart.getTime() - 7 * 864e5);
  const withDerived = (m) => ({
    ...m,
    ctr: m.impressions ? (m.clicks / m.impressions) * 100 : undefined,
    cpc: m.clicks && m.spend ? m.spend / m.clicks : undefined,
  });
  return [
    { client: clientId, source, level: 'campaign', entityName: name, periodStart: currStart, periodEnd: now, metrics: withDerived(current) },
    { client: clientId, source, level: 'campaign', entityName: name, periodStart: prevStart, periodEnd: prevEnd, metrics: withDerived(prior) },
  ];
}

run().catch((err) => {
  logger.error({ err }, '[seed] failed');
  process.exit(1);
});
