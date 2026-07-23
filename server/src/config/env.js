import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

// Validate + coerce the environment once at boot. Missing critical vars fail
// fast with a readable message; optional integration vars default to empty.
// Robust string -> boolean for env vars. `z.coerce.boolean()` treats ANY
// non-empty string (including "false") as true, so we parse explicitly and
// tolerate trailing comments/garbage (e.g. `false # note`).
const boolEnv = (def) =>
  z.preprocess((v) => {
    if (typeof v === 'boolean') return v;
    if (v === undefined || v === null || v === '') return def;
    const first = String(v).trim().toLowerCase().split(/[\s#(]/)[0];
    return ['1', 'true', 'yes', 'on'].includes(first);
  }, z.boolean());

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(8791),
  CLIENT_ORIGIN: z.string().default('http://localhost:5173'),
  SERVER_PUBLIC_URL: z.string().default('http://localhost:8791'),

  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  MONGODB_DB_NAME: z.string().default('skyup_rocky'),

  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 chars'),
  JWT_EXPIRES_IN: z.string().default('12h'),
  TOKEN_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'TOKEN_ENCRYPTION_KEY must be 64 hex chars (32 bytes)'),
  COOKIE_SECURE: boolEnv(false),
  COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),

  LLM_PROVIDER: z.enum(['mock', 'anthropic', 'openai']).default('mock'),
  LLM_MODEL: z.string().default('claude-sonnet-4-6'),
  ANTHROPIC_API_KEY: z.string().default(''),
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-4-6'),
  OPENAI_API_KEY: z.string().default(''),
  OPENAI_MODEL: z.string().default('gpt-4o-mini'),

  EMBEDDINGS_PROVIDER: z.enum(['mock', 'openai']).default('mock'),
  EMBEDDINGS_MODEL: z.string().default('text-embedding-3-small'),
  EMBEDDINGS_DIM: z.coerce.number().default(1536),
  VECTOR_INDEX_NAME: z.string().default('rocky_chunk_index'),

  META_APP_ID: z.string().default(''),
  META_APP_SECRET: z.string().default(''),
  META_API_VERSION: z.string().default('v20.0'),

  GOOGLE_ADS_DEVELOPER_TOKEN: z.string().default(''),
  GOOGLE_ADS_CLIENT_ID: z.string().default(''),
  GOOGLE_ADS_CLIENT_SECRET: z.string().default(''),
  GOOGLE_ADS_LOGIN_CUSTOMER_ID: z.string().default(''),

  GOOGLE_OAUTH_CLIENT_ID: z.string().default(''),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().default(''),
  GA4_DEFAULT_PROPERTY_ID: z.string().default(''),

  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  LOCAL_STORAGE_DIR: z.string().default('./storage/uploads'),
  S3_BUCKET: z.string().default(''),
  S3_REGION: z.string().default(''),
  AWS_ACCESS_KEY_ID: z.string().default(''),
  AWS_SECRET_ACCESS_KEY: z.string().default(''),

  // ---- Reels / social publishing ----
  CLOUDINARY_CLOUD_NAME: z.string().default(''),
  CLOUDINARY_API_KEY: z.string().default(''),
  CLOUDINARY_API_SECRET: z.string().default(''),
  CLOUDINARY_UPLOAD_FOLDER: z.string().default('rocky/reels'),
  PUBLISH_DRY_RUN: boolEnv(true),
  REELS_SCHEDULER_CRON: z.string().default('* * * * *'),

  // ---- Voice (text-to-speech) ----
  OPENAI_TTS_MODEL: z.string().default('gpt-4o-mini-tts'), // natural, supports tone instructions
  OPENAI_TTS_VOICE: z.string().default('nova'), // nova/shimmer/alloy/echo/fable/onyx

  MORNING_BRIEF_CRON: z.string().default('0 8 * * *'),
  BRIEF_TIMEZONE: z.string().default('Asia/Kolkata'),
  METRIC_SYNC_CRON: z.string().default('0 */6 * * *'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
    .join('\n');
  // eslint-disable-next-line no-console
  console.error(`\n[env] Invalid environment configuration:\n${issues}\n`);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';