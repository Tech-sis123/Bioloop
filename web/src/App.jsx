import { Suspense, lazy } from 'react';
import { Navigate, NavLink, Outlet, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth.jsx';
import { BottomNav, Spinner, useUnread } from './ui/kit.jsx';
import Icon, { LogoMark } from './ui/Icon.jsx';
// Marketing pages load separately so the app itself stays light (3D lives here)
const Landing = lazy(() => import('./pages/Landing.jsx'));
const Privacy = lazy(() => import('./pages/Privacy.jsx'));
import { initials } from './lib/format.js';
import { ForgotPassword, Login, Register, ResetPassword } from './pages/auth.jsx';
import { FindBin, ResidentHome, Rewards, SortGuide, StationDetail } from './pages/resident.jsx';
import { AlertsPage, ProfilePage } from './pages/shared.jsx';
import { CollectorMap, CollectorRoute } from './pages/collector.jsx';
import { RecyclerMarket, RecyclerOrders } from './pages/recycler.jsx';
import DashboardLayout from './pages/dashboard/Layout.jsx';
import Overview from './pages/dashboard/Overview.jsx';
import Stations from './pages/dashboard/Stations.jsx';
import Pickups from './pages/dashboard/Pickups.jsx';
import { Audit, Orgs, Reports, Users } from './pages/dashboard/People.jsx';
import { AlertsList } from './pages/shared.jsx';

const isStaff = (u) => u?.role === 'agency' || u?.role === 'admin';

function MobileShell() {
  const { user } = useAuth();
  const unread = useUnread();
  const navs = {
    resident: [
      { to: '/', icon: 'home', label: 'Home', end: true },
      { to: '/bin', icon: 'bin', label: 'My bin' },
      { to: '/alerts', icon: 'bell', label: 'Alerts', count: unread },
      { to: '/profile', icon: 'user', label: 'Profile' },
    ],
    collector: [
      { to: '/', icon: 'route', label: 'Route', end: true },
      { to: '/map', icon: 'map', label: 'Map' },
      { to: '/alerts', icon: 'bell', label: 'Alerts', count: unread },
      { to: '/profile', icon: 'user', label: 'Profile' },
    ],
    recycler: [
      { to: '/', icon: 'store', label: 'Market', end: true },
      { to: '/orders', icon: 'box', label: 'Orders' },
      { to: '/alerts', icon: 'bell', label: 'Alerts', count: unread },
      { to: '/profile', icon: 'user', label: 'Profile' },
    ],
  };
  const items = navs[user.role] || navs.resident;
  const ROLE = { resident: 'Resident', collector: 'Collector', recycler: 'Recycler' };
  return (
    <div className="app">
      <aside className="side-nav" aria-label="Sidebar">
        <NavLink to="/" className="logo"><LogoMark size={32} /><span>BioLoop</span></NavLink>
        <nav aria-label="Main">
          {items.map((it) => (
            <NavLink key={it.to} to={it.to} end={it.end} className={({ isActive }) => (isActive ? 'active' : '')}>
              <Icon name={it.icon} size={20} />{it.label}
              {it.count > 0 && <span className="count">{it.count > 9 ? '9+' : it.count}</span>}
            </NavLink>
          ))}
        </nav>
        {user.role === 'resident' && <div className="promo">Sort right, earn Loop points. Recyclables give the most.</div>}
        <NavLink to="/profile" className="me" style={{ textDecoration: 'none', color: 'inherit' }}>
          <span className="avatar">{initials(user.fullName)}</span>
          <span className="grow" style={{ minWidth: 0 }}>
            <span className="bold small truncate" style={{ display: 'block' }}>{user.fullName}</span>
            <span className="xs muted">{user.orgName || ROLE[user.role]}</span>
          </span>
        </NavLink>
      </aside>
      <div className="main">
        <Outlet />
      </div>
      <BottomNav items={items} blue={user.role === 'recycler'} />
    </div>
  );
}

function RequireAuth({ children }) {
  const { user, ready } = useAuth();
  if (!ready) return <Spinner />;
  if (!user) return <Navigate to="/welcome" replace />;
  return children;
}

function PublicOnly({ children }) {
  const { user, ready } = useAuth();
  if (!ready) return <Spinner />;
  if (user) return <Navigate to="/" replace />;
  return children;
}

function Home() {
  const { user } = useAuth();
  if (isStaff(user)) return <Navigate to="/dashboard" replace />;
  if (user.role === 'collector') return <CollectorRoute />;
  if (user.role === 'recycler') return <RecyclerMarket />;
  return <ResidentHome />;
}

function StaffOnly({ children }) {
  const { user } = useAuth();
  return isStaff(user) ? children : <Navigate to="/" replace />;
}

function RoleOnly({ roles, children }) {
  const { user } = useAuth();
  return roles.includes(user.role) ? children : <Navigate to="/" replace />;
}

function DashAlerts() {
  return (
    <>
      <header className="dash-head"><div><p className="muted">Bins, pickups and system events</p><h1>Alerts</h1></div></header>
      <section className="card"><AlertsList embedded /></section>
    </>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/privacy" element={<Suspense fallback={<Spinner />}><Privacy /></Suspense>} />
      <Route path="/welcome" element={<PublicOnly><Suspense fallback={<div style={{ minHeight: '100vh', background: '#0A2A1C' }} />}><Landing /></Suspense></PublicOnly>} />
      <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />
      <Route path="/register" element={<PublicOnly><Register /></PublicOnly>} />
      <Route path="/forgot-password" element={<PublicOnly><ForgotPassword /></PublicOnly>} />
      <Route path="/reset-password" element={<ResetPassword />} />

      <Route path="/dashboard" element={<RequireAuth><StaffOnly><DashboardLayout /></StaffOnly></RequireAuth>}>
        <Route index element={<Overview />} />
        <Route path="stations" element={<Stations />} />
        <Route path="pickups" element={<Pickups />} />
        <Route path="collectors" element={<Orgs kind="collector" key="collector" />} />
        <Route path="recyclers" element={<Orgs kind="recycler" key="recycler" />} />
        <Route path="users" element={<Users />} />
        <Route path="reports" element={<Reports />} />
        <Route path="alerts" element={<DashAlerts />} />
        <Route path="audit" element={<Audit />} />
      </Route>

      <Route element={<RequireAuth><MobileShell /></RequireAuth>}>
        <Route path="/" element={<Home />} />
        <Route path="/bin" element={<RoleOnly roles={['resident']}><StationDetail /></RoleOnly>} />
        <Route path="/stations/:id" element={<StationDetail />} />
        <Route path="/find" element={<FindBin />} />
        <Route path="/sort-guide" element={<SortGuide />} />
        <Route path="/rewards" element={<RoleOnly roles={['resident']}><Rewards /></RoleOnly>} />
        <Route path="/map" element={<RoleOnly roles={['collector']}><CollectorMap /></RoleOnly>} />
        <Route path="/orders" element={<RoleOnly roles={['recycler']}><RecyclerOrders /></RoleOnly>} />
        <Route path="/alerts" element={<AlertsPage />} />
        <Route path="/profile" element={<ProfilePage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
