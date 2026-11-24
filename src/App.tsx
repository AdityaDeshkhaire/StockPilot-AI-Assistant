import { Navigate, Route, Routes } from 'react-router-dom';
import { useSession } from './auth/session';
import { HOME, Layout, NAV } from './components/Layout';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { PRDetail, ReplenishmentList } from './pages/Replenishment';
import { PODetail, POList } from './pages/PurchaseOrders';
import { VendorSimulator } from './pages/VendorSimulator';
import { Receiving } from './pages/Receiving';
import { Discrepancies } from './pages/Discrepancies';
import { Putaway } from './pages/Putaway';
import { InventoryPage } from './pages/Inventory';
import { AgentLog } from './pages/AgentLog';
import { Settings } from './pages/Settings';
import { DatabaseViewer } from './pages/Database';
import type { ReactElement } from 'react';

function Guard({ path, el }: { path: string; el: ReactElement }) {
  const { user } = useSession();
  if (!user) return <Navigate to="/login" replace />;
  const allowed = NAV[user.role].some((n) => path.startsWith(n.to));
  return allowed ? el : <Navigate to={HOME[user.role]} replace />;
}

export default function App() {
  const { user } = useSession();
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={user ? <Layout /> : <Navigate to="/login" replace />}>
        <Route path="/dashboard" element={<Guard path="/dashboard" el={<Dashboard />} />} />
        <Route path="/replenishment" element={<Guard path="/replenishment" el={<ReplenishmentList />} />} />
        <Route path="/replenishment/:id" element={<Guard path="/replenishment" el={<PRDetail />} />} />
        <Route path="/purchase-orders" element={<Guard path="/purchase-orders" el={<POList />} />} />
        <Route path="/purchase-orders/:id" element={<Guard path="/purchase-orders" el={<PODetail />} />} />
        <Route path="/vendor" element={<Guard path="/vendor" el={<VendorSimulator />} />} />
        <Route path="/receiving" element={<Guard path="/receiving" el={<Receiving />} />} />
        <Route path="/discrepancies" element={<Guard path="/discrepancies" el={<Discrepancies />} />} />
        <Route path="/putaway" element={<Guard path="/putaway" el={<Putaway />} />} />
        <Route path="/inventory" element={<Guard path="/inventory" el={<InventoryPage />} />} />
        <Route path="/agent-log" element={<Guard path="/agent-log" el={<AgentLog />} />} />
        <Route path="/settings" element={<Guard path="/settings" el={<Settings />} />} />
        <Route path="/database" element={<Guard path="/database" el={<DatabaseViewer />} />} />
      </Route>
      <Route path="*" element={<Navigate to={user ? HOME[user.role] : '/login'} replace />} />
    </Routes>
  );
}
