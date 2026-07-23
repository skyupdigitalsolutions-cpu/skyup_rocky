# Reels Scheduler — install into Rocky

## New files (drop in as-is)
```
server/src/models/ScheduledPost.js
server/src/lib/cloudinary.js
server/src/connectors/instagram.js
server/src/services/reelsPublisher.js       (new folder: services/)
server/src/jobs/reelsScheduler.js
server/src/routes/reels.routes.js
client/src/pages/Reels.jsx
```

## Full-file replacements (short files, already updated)
```
server/src/config/rbac.js            (added REELS_READ / REELS_WRITE)
server/src/connectors/index.js       (registered instagram connector)
server/src/jobs/queue.js             (added reels poller cron)
```

## Small edits to existing files

### 1. server/src/index.js
```js
// add with the other route imports
import reelsRoutes from './routes/reels.routes.js';

// add with the other app.use('/api/...') lines
app.use('/api/reels', reelsRoutes);
```

### 2. server/src/models/Integration.js
```js
// widen the providers list so Instagram shows on the Integrations page
export const PROVIDERS = ['meta', 'google_ads', 'search_console', 'ga4', 'instagram'];
```

### 3. server/src/models/Client.js — inside accountRefs
```js
accountRefs: {
  metaAdAccountId: { type: String, default: '' },
  googleAdsCustomerId: { type: String, default: '' },
  gscSiteUrl: { type: String, default: '' },
  ga4PropertyId: { type: String, default: '' },
  instagramUserId: { type: String, default: '' },   // <-- add this line (IG business account id)
},
```

### 4. server/src/config/env.js — add inside the zod schema object
```js
  // ---- Reels / social publishing ----
  CLOUDINARY_CLOUD_NAME: z.string().default(''),
  CLOUDINARY_API_KEY: z.string().default(''),
  CLOUDINARY_API_SECRET: z.string().default(''),
  CLOUDINARY_UPLOAD_FOLDER: z.string().default('rocky/reels'),
  PUBLISH_DRY_RUN: z.coerce.boolean().default(true),   // true = simulate publish, no Graph call
  REELS_SCHEDULER_CRON: z.string().default('* * * * *'), // every minute
```
(META_APP_ID / META_APP_SECRET / META_API_VERSION already exist — Instagram reuses them.)

### 5. client/src/App.jsx
```jsx
import Reels from './pages/Reels.jsx';
// inside the protected <Route> group:
<Route path="/reels" element={<Reels />} />
```

### 6. client/src/components/Sidebar.jsx — add to the NAV array
```js
{ to: '/reels', label: 'Reels' },
```

## .env additions (server/.env)
```
CLOUDINARY_CLOUD_NAME=your_cloud
CLOUDINARY_API_KEY=xxxx
CLOUDINARY_API_SECRET=xxxx
CLOUDINARY_UPLOAD_FOLDER=rocky/reels
PUBLISH_DRY_RUN=true
REELS_SCHEDULER_CRON=* * * * *
```

## Test it TODAY (no Meta approval needed)
1. Add the Cloudinary vars (free tier is fine). Keep `PUBLISH_DRY_RUN=true`.
2. `npm run dev` (server) + `npm run dev` (client).
3. Sidebar → **Reels**. Choose a client (Skyup), upload a short vertical mp4, hit **Generate** for a caption, set the time to ~2 min out, **Schedule reel**.
4. Within a minute the poller flips it `scheduled → processing → published` with a `dry-run` chip. The whole state machine is exercised — just no real IG call.
5. **Publish now** works the same way for instant testing.

## Going live (when the IG app is ready)
1. In the Meta app add **Instagram** + scopes: `instagram_basic`, `instagram_content_publish`, `pages_show_list`, `business_management`, and submit for review.
2. Register redirect: `${SERVER_PUBLIC_URL}/api/integrations/instagram/callback`
   → **add this route to `integrations.routes.js`** next to the other callbacks:
   ```js
   router.get('/instagram/callback', asyncHandler((req, res) => handleCallback('instagram', req, res)));
   ```
3. Connect from **Integrations → (client) → Instagram** (or `?simulate=1` in dev).
4. Set the client's `accountRefs.instagramUserId` (the IG *business account* id).
5. Set `PUBLISH_DRY_RUN=false`. Done — reels now post for real.

## Notes / gotchas baked in
- **No double-publish:** the poller claims each post with an atomic `findOneAndUpdate` (scheduled→processing). Overlapping ticks and `publish-now` can't race.
- **Reel transcode is async:** the publisher creates the media container, polls `status_code` until `FINISHED` (up to 5 min) *before* calling `media_publish` — skipping this is the #1 cause of IG publish failures.
- **Retries:** up to 3 attempts with 5/10/15-min backoff; then `failed` (editable/rescheduable to re-arm).
- **Big files never touch Express:** the browser uploads straight to Cloudinary using a short-lived signed signature; the API only stores the resulting URL.
- **`approval` mode** is the harness gate for when you *don't* pre-approve by uploading — the reel holds until someone taps Approve, then the poller picks it up.
