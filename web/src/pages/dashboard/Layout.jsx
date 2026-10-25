import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth.jsx';
import { useApi } from '../../lib/hooks.js';
import Icon, { LogoMark } from '../../ui/Icon.jsx';

export default function DashboardLayout() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const { data: unread } = useApi('/notifications/unread-count', { interval: 30000 });
  const { data: reports } = useApi('/reports?status=open', { interval: 60000 });
  const items = [
    ['/dashboard', 'grid', 'Overview', true],
    ['/dashboard/stations', 'bin', 'Stations'],
    ['/dashboard/pickups', 'truck', 'Pickups'],
    ['/dashboard/collectors', 'route', 'Collectors'],
    ['/dashboard/recyclers', 'box', 'Recyclers'],
    ['/dashboard/reports', 'flag', 'Reports', false, reports?.reports?.length],
    ['/dashboard/users', 'users', 'People'],
    ['/dashboard/alerts', 'bell', 'Alerts', false, unread?.unread],
  ];
  if (user.role === 'admin') items.push(['/dashboard/audit', 'chart', 'Audit log']);

  return (
    <div className="dash">
      <aside className="dash-side">
        <div className="row" style={{ padding: '0 8px', gap: 10 }}>
          <LogoMark a="#8FD3A8" b="#8DB8E6" />
          <span className="display" style={{ fontSize: 21 }}>BioLoop</span>
          <span className="tag">{user.role === 'admin' ? 'Admin' : 'Agency'}</span>
          <button type="button" className="icon-btn dash-mobile-bar" style={{ marginLeft: 'auto', background: 'transparent', borderColor: 'rgba(255,255,255,0.2)', color: '#fff' }} aria-label="Sign out" onClick={async () => { await logout(); nav('/login'); }}>
            <Icon name="logout" size={18} />
          </button>
        </div>
        <nav aria-label="Dashboard">
          {items.map(([to, icon, label, end, count]) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => (isActive ? 'active' : '')}>
              <Icon name={icon} size={19} />{label}
              {count > 0 && <span className="count">{count > 99 ? '99+' : count}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="who">
          <span><strong style={{ color: '#fff' }}>{user.fullName}</strong><br />{user.email}</span>
          <button type="button" onClick={async () => { await logout(); nav('/login'); }}>Sign out</button>
        </div>
      </aside>
      <main className="dash-main">
        <Outlet />
      </main>
    </div>
  );
}
