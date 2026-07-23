import { useState, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar.jsx';
import { useAuth } from '../store/auth.jsx';

const TITLES = {
  '/': 'COMMAND CENTER',
  '/chat': 'ASK ROCKY',
  '/clients': 'CLIENTS',
  '/reels': 'SOCIAL MEDIA',
  '/settings': 'SETTINGS',
};

function useClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

const IconBtn = ({ d, dot, ...p }) => (
  <button className="hud-iconbtn" {...p}>
    {dot && <span className="dot" />}
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  </button>
);

export default function Layout() {
  const { logout, user } = useAuth();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const now = useClock();
  const title =
    TITLES[pathname] ||
    (pathname.startsWith('/clients/') ? 'CLIENT DETAIL' : pathname.startsWith('/integrations') ? 'INTEGRATIONS' : 'ROCKY');

  return (
    <div className="app">
      <Sidebar open={open} />
      <div className="main">
        <div className="topbar">
          <div className="hud-top-title">
            <b>ROCKY</b> <span>// {title}</span>
          </div>
          <div className="hud-top-right">
            <div className="hud-sys"><i />System Online</div>
            <div className="hud-clock">
              <div className="t">{now.toLocaleTimeString('en-IN', { hour12: true })}</div>
              <div className="d">{now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase()}</div>
            </div>
            <IconBtn d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5" title="Search" />
            <IconBtn d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" dot title="Notifications" />
            <IconBtn d="M16 21v-2a4 4 0 0 0-8 0v2M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6" title={user?.email} onClick={logout} />
          </div>
        </div>
        <div className="content">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
