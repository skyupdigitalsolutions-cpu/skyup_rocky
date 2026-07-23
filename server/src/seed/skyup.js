import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { connectDb } from '../config/db.js';
import { Client } from '../models/Client.js';
import { Integration } from '../models/Integration.js';
import { encryptSecret } from '../lib/crypto.js';

// One-time setup for the agency's own account.
//  1. Upserts the "Skyup Digital Solutions" client with its Meta/IG account refs.
//  2. If IG_USER_TOKEN is set in .env, exchanges it for a LONG-LIVED Page token
//     (never expires) and stores it encrypted so the reels publisher can post.
//
// Run from the server folder:  node src/seed/skyup.js
// The IG_USER_TOKEN is only needed for this run — delete it from .env after.

const IG_USER_ID = '17841478584577892'; // Instagram business account id
const PAGE_ID = '890856174115974';      // Facebook Page id
const AD_ACCOUNT_ID = '890856174115974';

async function main() {
  await connectDb();

  // --- 1. Client record ---
  let client = await Client.findOne({ name: /^skyup digital/i });
  if (!client) {
    client = await Client.create({
      name: 'Skyup Digital Solutions',
      industry: 'Digital Marketing & AI Automation Agency',
      website: 'https://skyupdigital.com',
      status: 'active',
      brandNotes: 'Bengaluru-based agency. Confident, sharp, results-driven voice.',
      targetMarket: 'SMBs and local businesses in India needing digital marketing + automation.',
    });
    console.log('✅ Created client: Skyup Digital Solutions');
  } else {
    console.log('• Client already exists: Skyup Digital Solutions');
  }
  client.accountRefs = {
    ...(client.accountRefs || {}),
    instagramUserId: IG_USER_ID,
    metaAdAccountId: AD_ACCOUNT_ID,
  };
  await client.save();
  console.log(`   client id: ${client._id}  ·  ig: ${IG_USER_ID}  ·  page: ${PAGE_ID}`);

  // --- 2. Instagram connection (optional, needs IG_USER_TOKEN) ---
  const userToken = process.env.IG_USER_TOKEN;
  if (!userToken) {
    console.log('\nℹ  IG_USER_TOKEN not set — client is ready but Instagram is NOT connected yet.');
    console.log('   To enable real posting: put a User token in .env as IG_USER_TOKEN and re-run.\n');
    await mongoose.disconnect();
    return;
  }
  if (!env.META_APP_ID || !env.META_APP_SECRET) {
    throw new Error('META_APP_ID and META_APP_SECRET must be set in .env to exchange the token.');
  }

  const v = env.META_API_VERSION;

  // 2a. short-lived user token -> long-lived user token (~60 days)
  const exUrl = new URL(`https://graph.facebook.com/${v}/oauth/access_token`);
  exUrl.searchParams.set('grant_type', 'fb_exchange_token');
  exUrl.searchParams.set('client_id', env.META_APP_ID);
  exUrl.searchParams.set('client_secret', env.META_APP_SECRET);
  exUrl.searchParams.set('fb_exchange_token', userToken);
  const exRes = await fetch(exUrl);
  const exData = await exRes.json();
  if (!exRes.ok) throw new Error(`Long-lived exchange failed: ${JSON.stringify(exData?.error || exData)}`);
  const llUserToken = exData.access_token;
  console.log('✅ Got long-lived user token');

  // 2b. fetch the Page token (long-lived, effectively non-expiring)
  const acctUrl = new URL(`https://graph.facebook.com/${v}/me/accounts`);
  acctUrl.searchParams.set('access_token', llUserToken);
  const acctRes = await fetch(acctUrl);
  const acctData = await acctRes.json();
  if (!acctRes.ok) throw new Error(`me/accounts failed: ${JSON.stringify(acctData?.error || acctData)}`);
  const page = (acctData.data || []).find((p) => p.id === PAGE_ID) || (acctData.data || [])[0];
  if (!page?.access_token) throw new Error('Could not find a Page access token — is the Page assigned to your user?');
  const pageToken = page.access_token;
  console.log(`✅ Got long-lived Page token for: ${page.name}`);

  // 2c. store encrypted on the instagram integration
  await Integration.findOneAndUpdate(
    { client: client._id, provider: 'instagram' },
    {
      status: 'connected',
      accountLabel: '@skyupdigitalsolutions',
      externalAccountId: IG_USER_ID,
      credentials: { accessToken: encryptSecret(pageToken) },
      lastError: '',
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  console.log('\n🎉 Instagram connected for Skyup Digital Solutions.');
  console.log('   → Set PUBLISH_DRY_RUN=false in .env and restart to post for real.');
  console.log('   → You can now DELETE IG_USER_TOKEN from .env (the Page token is stored).\n');
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('\n❌ skyup seed failed:', err.message, '\n');
  process.exit(1);
});
