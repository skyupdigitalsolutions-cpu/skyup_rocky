import { NavLink } from 'react-router-dom';
import { useAuth } from '../store/auth.jsx';

// Rocky mark: stylized R inside a targeting reticle with an upward arrow.
function RockyMark({ className }) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none">
      <circle cx="24" cy="24" r="21" stroke="var(--hud)" strokeWidth="1.5" opacity="0.6" />
      <circle cx="24" cy="24" r="15" stroke="var(--hud)" strokeWidth="2" />
      {[0, 90, 180, 270].map((a) => (
        <line key={a} x1="24" y1="3" x2="24" y2="8" stroke="var(--hud)" strokeWidth="2"
          transform={`rotate(${a} 24 24)`} />
      ))}
      <path d="M18 32V16h7a4 4 0 0 1 0 8h-4m4 0 5 8" stroke="#fff" strokeWidth="2.4"
        strokeLinecap="round" strokeLinejoin="round" />
      <path d="M28 20l6-6m0 0h-4m4 0v4" stroke="var(--hud-bright)" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const I = {
  dash: 'M3 11 12 3l9 8M5 10v10h14V10',
  chat: 'M4 5h16v11H8l-4 4V5z',
  clients: 'M16 20v-2a4 4 0 0 0-8 0v2M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6M22 20v-2a4 4 0 0 0-3-3.8',
  reels: 'M4 4h16v16H4zM4 9h16M9 4v16M15 4v16',
  ads: 'M3 3h18v14H3zM3 21h18M8 13l3-4 2 2 3-5',
  seo: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5',
  web: 'M3 4h18v16H3zM3 8h18M6 6h.01M9 6h.01',
  social: 'M18 8a3 3 0 1 0-2.8-4M6 15a3 3 0 1 0 2.8 4M15.4 6.5l-6.8 4M8.6 13.5l6.8 4',
  creative: 'M12 3l2.5 5.5L20 9l-4 4 1 6-5-3-5 3 1-6-4-4 5.5-.5z',
  reports: 'M4 20V10M10 20V4M16 20v-7M20 20H2',
  auto: 'M13 2 3 14h7l-1 8 10-12h-7z',
  integ: 'M9 3v6M15 3v6M6 9h12v4a6 6 0 0 1-12 0zM12 19v2',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12a7 7 0 0 0-.1-1.3l2-1.5-2-3.4-2.4 1a7 7 0 0 0-2.2-1.3L14 2h-4l-.3 2.5a7 7 0 0 0-2.2 1.3l-2.4-1-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .4 0 .9.1 1.3l-2 1.5 2 3.4 2.4-1a7 7 0 0 0 2.2 1.3L10 22h4l.3-2.5a7 7 0 0 0 2.2-1.3l2.4 1 2-3.4-2-1.5c.1-.4.1-.9.1-1.3z',
};
const Ic = ({ d }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

const NAV = [
  { to: '/', label: 'Dashboard', icon: 'dash', end: true },
  { to: '/chat', label: 'Ask Rocky', icon: 'chat' },
  { to: '/clients', label: 'Clients', icon: 'clients' },
  { to: '/reels', label: 'Social Media', icon: 'reels' },
  { to: '/ads', label: 'Ads Manager', icon: 'ads' },
  { to: '/integrations/select', label: 'Integrations', icon: 'integ' },
  { to: '/settings', label: 'Settings', icon: 'settings', perm: 'user:manage' },
];

// Roadmap verticals — shown dimmed so the OS reads as a full agency brain.
const SOON = [
  { label: 'SEO Intelligence', icon: 'seo' },
  { label: 'Websites', icon: 'web' },
  { label: 'Creatives', icon: 'creative' },
  { label: 'Reports', icon: 'reports' },
  { label: 'Automations', icon: 'auto' },
];

export default function Sidebar({ open }) {
  const { user, permissions } = useAuth();
  return (
    <aside className={`sidebar ${open ? 'open' : ''}`}>
      <div className="hud-brand">
        <RockyMark className="mark" />
        <div className="txt">
          <div className="name">ROCKY</div>
          <div className="sub">Agency Intelligence OS</div>
        </div>
      </div>

      <nav className="hud-nav">
        {NAV.filter((n) => !n.perm || permissions.includes(n.perm)).map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? 'active' : '')}>
            <Ic d={I[n.icon]} />
            {n.label}
          </NavLink>
        ))}
        {SOON.map((n) => (
          <div className="soon" key={n.label} title="Coming soon">
            <Ic d={I[n.icon]} />
            {n.label}
            <span className="tag">SOON</span>
          </div>
        ))}
      </nav>

      <div className="hud-foot">
        <RockyMark className="rk" />
        <div>
          <div className="name">SKYUP</div>
          <div className="sub">Digital Solutions</div>
          <div className="online"><i />ONLINE</div>
        </div>
      </div>
    </aside>
  );
}