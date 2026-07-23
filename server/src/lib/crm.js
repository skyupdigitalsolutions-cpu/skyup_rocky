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
let AttendanceModel = null;
let ProjectModel = null;
let UserModel = null;
let MetaConfigModel = null;
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
  const attendanceSchema = new mongoose.Schema({ user: mongoose.Schema.Types.ObjectId, company: mongoose.Schema.Types.ObjectId, date: String, status: String, loginTime: Date }, { strict: false, collection: 'attendances' });
  const projectSchema = new mongoose.Schema({ name: String, company: mongoose.Schema.Types.ObjectId, isActive: Boolean, status: String }, { strict: false, collection: 'projects' });
  const userSchema = new mongoose.Schema({ name: String, company: mongoose.Schema.Types.ObjectId, role: String }, { strict: false, collection: 'users' });
  const metaConfigSchema = new mongoose.Schema({ campaignName: String, adSetName: String, metaAdsetId: String, metaCampaignId: String, company: mongoose.Schema.Types.ObjectId }, { strict: false, collection: 'metaconfigs' });
  LeadModel = conn.model('CrmLead', leadSchema);
  CompanyModel = conn.model('CrmCompany', companySchema);
  AttendanceModel = conn.model('CrmAttendance', attendanceSchema);
  ProjectModel = conn.model('CrmProject', projectSchema);
  UserModel = conn.model('CrmUser', userSchema);
  MetaConfigModel = conn.model('CrmMetaConfig', metaConfigSchema);
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

  const base = { company: new mongoose.Types.ObjectId(String(companyId)) };
  let match = base;
  if (window !== 'all') {
    const since = window === 'today' ? istMidnight() : new Date(Date.now() - Number(window || 1) * 864e5);
    match = { ...base, createdAt: { $gte: since } };
  }

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

// ---- follow-ups due / overdue (scheduledCalls not done) ---------------------
export async function followUpStats() {
  getConn();
  const companyId = await getSkyupCompanyId();
  if (!companyId) throw new Error('Skyup company not resolved');
  const cid = new mongoose.Types.ObjectId(String(companyId));
  const now = new Date();
  const istDay = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const endOfToday = new Date(`${istDay}T23:59:59+05:30`);

  // Pending (not done) follow-up calls due by end of today, split into overdue vs due-today.
  const rows = await LeadModel.find({
    company: cid,
    'scheduledCalls': { $elemMatch: { done: false, scheduledAt: { $lte: endOfToday } } },
  }).select('scheduledCalls').lean();

  let due = 0, overdue = 0;
  const startOfToday = new Date(`${istDay}T00:00:00+05:30`);
  for (const l of rows) {
    for (const c of l.scheduledCalls || []) {
      if (c.done || !c.scheduledAt) continue;
      const t = new Date(c.scheduledAt);
      if (t > endOfToday) continue;
      if (t < startOfToday) overdue++;
      else due++;
    }
  }
  return { due, overdue };
}

// ---- attendance today -------------------------------------------------------
export async function attendanceToday() {
  getConn();
  const companyId = await getSkyupCompanyId();
  if (!companyId) throw new Error('Skyup company not resolved');
  const cid = new mongoose.Types.ObjectId(String(companyId));
  const istDay = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const [present, totalEmployees] = await Promise.all([
    AttendanceModel.countDocuments({ company: cid, date: istDay, status: { $in: ['active', 'on_break', 'idle'] } }),
    UserModel.countDocuments({ company: cid }),
  ]);
  return { present, total: totalEmployees };
}

// ---- active projects --------------------------------------------------------
export async function projectStats() {
  getConn();
  const companyId = await getSkyupCompanyId();
  if (!companyId) throw new Error('Skyup company not resolved');
  const cid = new mongoose.Types.ObjectId(String(companyId));
  const active = await ProjectModel.countDocuments({ company: cid, isActive: true });
  return { active };
}

// ---- flexible NL query support: list leads with filters ---------------------
// filters: { window, temperature, status, uncontacted } ; returns lean rows
export async function queryLeads({ window = 'today', temperature, status, limit = 50 } = {}) {
  getConn();
  const companyId = await getSkyupCompanyId();
  if (!companyId) throw new Error('Skyup company not resolved');
  const cid = new mongoose.Types.ObjectId(String(companyId));
  const q = { company: cid };
  if (window !== 'all') {
    const since = window === 'today'
      ? new Date(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) + 'T00:00:00+05:30')
      : new Date(Date.now() - Number(window || 1) * 864e5);
    q.createdAt = { $gte: since };
  }
  if (temperature) q.temperature = temperature;
  if (status) q.status = status;
  const rows = await LeadModel.find(q).select('name phone status temperature campaign adSetName createdAt scheduledCalls').sort({ createdAt: -1 }).limit(limit).lean();
  return rows;
}

// ---- Natural-language CRM answers -------------------------------------------
// Matches common questions and answers from REAL data. Returns a string, or
// null if nothing matched (so the caller can fall back to the normal LLM).
export async function answerCrmQuery(q) {
  const text = String(q || '').toLowerCase();

  // conversions (today / this week)
  if (/(how many )?conversion|converted/.test(text)) {
    const win = /week|7 ?day/.test(text) ? 7 : 'today';
    const s = await leadStats(win);
    const label = win === 'today' ? 'today' : 'in the last 7 days';
    return `${s.converted} conversion${s.converted === 1 ? '' : 's'} ${label}, from ${s.total} lead${s.total === 1 ? '' : 's'}.`;
  }

  // hot leads not contacted
  if (/hot/.test(text) && /(not|haven'?t|havent|un|pending).*(contact|call|reach)/.test(text)) {
    const rows = await queryLeads({ window: 'all', temperature: 'Hot', limit: 200 });
    const uncontacted = rows.filter((r) => !(r.scheduledCalls || []).some((c) => c.done) && r.status === 'New');
    if (!uncontacted.length) return `All hot leads have been contacted. 👍`;
    const names = uncontacted.slice(0, 8).map((r) => r.name || 'Unknown').join(', ');
    return `${uncontacted.length} hot lead${uncontacted.length === 1 ? '' : 's'} not contacted yet: ${names}${uncontacted.length > 8 ? ', …' : ''}.`;
  }

  // hot/warm/cold count
  if (/(how many )?(hot|warm|cold) leads?/.test(text)) {
    const temp = /hot/.test(text) ? 'Hot' : /warm/.test(text) ? 'Warm' : 'Cold';
    const win = /today/.test(text) ? 'today' : 'all';
    const rows = await queryLeads({ window: win, temperature: temp, limit: 500 });
    return `${rows.length} ${temp.toLowerCase()} lead${rows.length === 1 ? '' : 's'}${win === 'today' ? ' today' : ''}.`;
  }

  // follow-ups
  if (/follow.?up/.test(text)) {
    const fu = await followUpStats();
    return `${fu.due} follow-up${fu.due === 1 ? '' : 's'} due today, ${fu.overdue} overdue.`;
  }

  // today's leads / show leads
  if (/(show|today'?s|list|how many).*lead/.test(text) || /leads today/.test(text)) {
    const win = /week|7 ?day/.test(text) ? 7 : 'today';
    const rows = await queryLeads({ window: win, limit: 200 });
    if (!rows.length) return `No new leads in the CRM ${win === 'today' ? 'today' : 'this week'} yet.`;
    const hot = rows.filter((r) => r.temperature === 'Hot').length;
    const names = rows.slice(0, 8).map((r) => r.name || 'Unknown').join(', ');
    return `${rows.length} lead${rows.length === 1 ? '' : 's'} ${win === 'today' ? 'today' : 'this week'} (${hot} hot): ${names}${rows.length > 8 ? ', …' : ''}.`;
  }

  // best converting ad set (CRM side — conversions per ad set)
  if (/(which|best|top).*(ad ?set|campaign).*(convert|convers)/.test(text) || /best converting/.test(text)) {
    const rows = await leadsByAdSet(30);
    const withConv = rows.filter((r) => r.converted > 0).sort((a, b) => b.converted - a.converted);
    if (!withConv.length) return `No conversions attributed to any ad set in the last 30 days yet.`;
    const top = withConv[0];
    return `Best converting (last 30d): "${top.adSetName}" — ${top.converted} conversions from ${top.leads} leads (${Math.round((top.converted / top.leads) * 100)}%). For cost-per-conversion, open the Attribution view.`;
  }

  // business summary
  if (/business summary|today'?s summary|skyup summary|daily summary|summary/.test(text)) {
    const [s, fu, att, proj] = await Promise.all([
      leadStats('today'),
      followUpStats().catch(() => ({ due: 0, overdue: 0 })),
      attendanceToday().catch(() => null),
      projectStats().catch(() => ({ active: 0 })),
    ]);
    const parts = [`${s.total} leads today (${s.hot} hot, ${s.converted} converted)`, `${fu.due} follow-ups due and ${fu.overdue} overdue`];
    if (att) parts.push(`${att.present} of ${att.total} present`);
    parts.push(`${proj.active} active projects`);
    return `Skyup today: ${parts.join('; ')}.`;
  }

  return null;
}

// ---- Per-ad-set attribution: leads + conversions grouped by MetaConfig ------
// Returns rows keyed by the Meta ad set / campaign IDs so we can join to Meta
// spend and compute cost-per-lead & cost-per-conversion. `window` = 'today' | days | 'all'.
export async function leadsByAdSet(window = 30) {
  getConn();
  const companyId = await getSkyupCompanyId();
  if (!companyId) throw new Error('Skyup company not resolved');
  const cid = new mongoose.Types.ObjectId(String(companyId));

  const match = { company: cid };
  if (window !== 'all') {
    const since = window === 'today'
      ? new Date(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) + 'T00:00:00+05:30')
      : new Date(Date.now() - Number(window || 30) * 864e5);
    match.createdAt = { $gte: since };
  }

  // Group leads per metaConfigId with a converted count.
  const grouped = await LeadModel.aggregate([
    { $match: match },
    { $group: {
      _id: '$metaConfigId',
      leads: { $sum: 1 },
      converted: { $sum: { $cond: [{ $eq: ['$status', 'Converted'] }, 1, 0] } },
      interested: { $sum: { $cond: [{ $eq: ['$status', 'Interested'] }, 1, 0] } },
      adSetName: { $first: '$adSetName' },
      campaign: { $first: '$campaign' },
    } },
  ]);

  // Resolve MetaConfig -> meta ad-set / campaign ids.
  const ids = grouped.map((g) => g._id).filter(Boolean);
  const configs = ids.length ? await MetaConfigModel.find({ _id: { $in: ids } }).select('campaignName adSetName metaAdsetId metaCampaignId').lean() : [];
  const byId = new Map(configs.map((c) => [String(c._id), c]));

  return grouped.map((g) => {
    const cfg = g._id ? byId.get(String(g._id)) : null;
    return {
      metaConfigId: g._id ? String(g._id) : null,
      adSetName: cfg?.adSetName || g.adSetName || g.campaign || 'Unattributed',
      campaignName: cfg?.campaignName || g.campaign || '',
      metaAdsetId: cfg?.metaAdsetId || '',
      metaCampaignId: cfg?.metaCampaignId || '',
      leads: g.leads,
      converted: g.converted,
      interested: g.interested,
    };
  });
}

// Stale leads: in New/Interested and older than `days` with no completed follow-up.
export async function staleLeads(days = 3, limit = 50) {
  getConn();
  const companyId = await getSkyupCompanyId();
  if (!companyId) throw new Error('Skyup company not resolved');
  const cid = new mongoose.Types.ObjectId(String(companyId));
  const cutoff = new Date(Date.now() - days * 864e5);
  const rows = await LeadModel.find({
    company: cid,
    status: { $in: ['New', 'Interested'] },
    createdAt: { $lte: cutoff },
  }).select('name phone status temperature createdAt').sort({ createdAt: 1 }).limit(limit).lean();
  return rows;
}