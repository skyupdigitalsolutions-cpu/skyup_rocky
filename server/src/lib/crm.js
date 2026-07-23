import mongoose from 'mongoose';
import { logger } from './logger.js';

// Read-only bridge to the Skyup CRM database. Rocky opens a SEPARATE mongoose
// connection to the CRM's Mongo and reads the `leads` collection — no changes
// or redeploy to the CRM itself. Multi-tenant: we scope to the Skyup company.
//
// .env:
//   CRM_MONGO_URI     = the CRM's MongoDB connection string (required)
//   CRM_DB_NAME       = optional db name override
//   CRM_COMPANY_NAME  = company to read (default "Skyup")  — resolved by name
//   CRM_COMPANY_ID    = optional exact company _id (skips name lookup)

let conn = null;
let LeadModel = null;
let CompanyModel = null;
let cachedCompanyId = null;

export function crmConfigured() {
  return Boolean(process.env.CRM_MONGO_URI);
}

function getConn() {
  if (conn) return conn;
  if (!process.env.CRM_MONGO_URI) return null;
  conn = mongoose.createConnection(process.env.CRM_MONGO_URI, {
    dbName: process.env.CRM_DB_NAME || undefined,
    serverSelectionTimeoutMS: 8000,
  });
  conn.on('error', (e) => logger.warn({ err: e.message }, '[crm] connection error'));
  conn.once('open', () => logger.info('[crm] connected to CRM database (read-only)'));

  // Loose schemas (strict:false) — we only read a few fields.
  const leadSchema = new mongoose.Schema(
    { status: String, temperature: String, company: mongoose.Schema.Types.ObjectId, campaign: String, date: Date },
    { strict: false, collection: 'leads' }
  );
  const companySchema = new mongoose.Schema({ name: String }, { strict: false, collection: 'companies' });
  LeadModel = conn.model('CrmLead', leadSchema);
  CompanyModel = conn.model('CrmCompany', companySchema);
  return conn;
}

export async function getSkyupCompanyId() {
  if (cachedCompanyId) return cachedCompanyId;
  if (process.env.CRM_COMPANY_ID) {
    cachedCompanyId = process.env.CRM_COMPANY_ID;
    return cachedCompanyId;
  }
  getConn();
  if (!CompanyModel) return null;
  const name = process.env.CRM_COMPANY_NAME || 'Skyup';
  const c = await CompanyModel.findOne({ name: new RegExp(name, 'i') }).lean();
  cachedCompanyId = c?._id ? String(c._id) : null;
  if (!cachedCompanyId) logger.warn(`[crm] no company matched name ~"${name}"`);
  return cachedCompanyId;
}

// IST midnight as a Date (start of "today" in Asia/Kolkata).
function istMidnight() {
  const istDay = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); // YYYY-MM-DD
  return new Date(`${istDay}T00:00:00+05:30`);
}

// Aggregate lead outcomes for the Skyup company.
//   window: 'today' (since IST midnight) | number of days back
// Returns { total, statuses:{}, temps:{Hot,Warm,Cold,Unset}, converted, interested,
//           notInterested, newLeads, hot, warm, cold, window }
export async function leadStats(window = 'today') {
  if (!crmConfigured()) throw new Error('CRM not configured (set CRM_MONGO_URI)');
  getConn();
  const companyId = await getSkyupCompanyId();
  if (!companyId) throw new Error('Could not resolve the Skyup company in the CRM');

  const since = window === 'today' ? istMidnight() : new Date(Date.now() - Number(window || 1) * 864e5);
  const match = { company: new mongoose.Types.ObjectId(String(companyId)), createdAt: { $gte: since } };

  const [byStatusRaw, byTempRaw, total] = await Promise.all([
    LeadModel.aggregate([{ $match: match }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    LeadModel.aggregate([{ $match: match }, { $group: { _id: '$temperature', n: { $sum: 1 } } }]),
    LeadModel.countDocuments(match),
  ]);

  const statuses = {};
  for (const r of byStatusRaw) statuses[r._id || 'Unknown'] = r.n;
  const temps = { Hot: 0, Warm: 0, Cold: 0, Unset: 0 };
  for (const r of byTempRaw) {
    const key = ['Hot', 'Warm', 'Cold'].includes(r._id) ? r._id : 'Unset';
    temps[key] += r.n;
  }
  const s = (k) => statuses[k] || 0;
  return {
    window,
    since,
    total,
    statuses,
    temps,
    newLeads: s('New'),
    interested: s('Interested'),
    converted: s('Converted'),
    notInterested: s('Not Interested'),
    hot: temps.Hot,
    warm: temps.Warm,
    cold: temps.Cold,
  };
}