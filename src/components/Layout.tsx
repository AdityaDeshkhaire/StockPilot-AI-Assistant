import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { ROLE_LABEL, useSession, useUser } from '../auth/session';
import type { Role } from '../domain/types';
import { fmtDate, useSimDate } from '../hooks';
import { getAgentMode } from '../agents/client';
import { Notices } from './ui';

export const NAV: Record<Role, { to: string; label: string }[]> = {
  Store_Manager: [
    { to: '/dashboard', label: 'Dashboard' },
    { to: '/replenishment', label: 'Replenishment' },
    { to: '/purchase-orders', label: 'Purchase Orders' },
    { to: '/discrepancies', label: 'Discrepancies' },
    { to: '/inventory', label: 'Inventory' },
    { to: '/agent-log', label: 'Agent Log' },
    { to: '/settings', label: 'Settings' },
    { to: '/database', label: 'Database' },
  ],
  Regional_Manager: [
    { to: '/dashboard', label: 'Dashboard' },
    { to: '/replenishment', label: 'Replenishment' },
    { to: '/purchase-orders', label: 'Purchase Orders' },
    { to: '/agent-log', label: 'Agent Log' },
    { to: '/database', label: 'Database' },
  ],
  Receiving_Clerk: [{ to: '/receiving', label: 'Receiving' }],
  Stock_Associate: [{ to: '/putaway', label: 'Put-Away' }],
  Vendor: [{ to: '/vendor', label: 'Open POs' }],
};

export const HOME: Record<Role, string> = {
  Store_Manager: '/dashboard',
  Regional_Manager: '/dashboard',
  Receiving_Clerk: '/receiving',
  Stock_Associate: '/putaway',
  Vendor: '/vendor',
};

const SWITCH_ROLES: Role[] = ['Store_Manager', 'Receiving_Clerk', 'Stock_Associate', 'Vendor', 'Regional_Manager'];

export function Layout() {
  const user = useUser();
  const { logout, switchRole } = useSession();
  const nav = useNavigate();
  const date = useSimDate();
  const mode = getAgentMode();
  const [open, setOpen] = useState(false);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 bg-navy text-white shadow">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-3 px-4 py-2.5">
          <button className="md:hidden" onClick={() => setOpen(!open)} aria-label="Menu">
            ☰
          </button>
          <div className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <span className="grid h-7 w-7 place-items-center rounded-md bg-white/15 text-sm">SP</span>
            StockPilot
          </div>
          <span className="hidden rounded bg-white/10 px-2 py-0.5 text-xs sm:inline">Store #12 · Dallas</span>
          <div className="ml-auto flex flex-wrap items-center gap-3 text-sm">
            <span className="rounded bg-white/10 px-2 py-1" title="Simulated business date">
              📅 {fmtDate(date)}
            </span>
            <span className={`rounded px-2 py-1 text-xs font-semibold ${mode === 'live' ? 'bg-emerald-500/30' : 'bg-[#5B3E96]'}`} title="Agent mode">
              AI: {mode === 'live' ? 'Live' : 'Mock'}
            </span>
            <label className="flex items-center gap-1.5">
              <span className="hidden text-white/70 lg:inline">Role</span>
              <select
                className="rounded bg-white/10 px-2 py-1 text-sm text-white outline-none [&>option]:text-slate-800"
                value={user.role}
                onChange={async (e) => {
                  const r = e.target.value as Role;
                  await switchRole(r);
                  nav(HOME[r]);
                }}
              >
                {SWITCH_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
            </label>
            <span className="hidden text-white/80 md:inline">
              {user.first_name} {user.last_name}
            </span>
            <button
              className="rounded px-2 py-1 text-white/80 hover:bg-white/10"
              onClick={() => {
                logout();
                nav('/login');
              }}
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <div className="mx-auto flex max-w-[1400px]">
        <aside className={`${open ? 'block' : 'hidden'} w-52 shrink-0 border-r border-slate-200 bg-white md:block`}>
          <nav className="sticky top-14 flex flex-col gap-0.5 p-3">
            {NAV[user.role].map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  `rounded-md px-3 py-2 text-sm font-medium ${isActive ? 'bg-navy text-white' : 'text-slate-600 hover:bg-slate-100'}`
                }
              >
                {n.label}
              </NavLink>
            ))}
            <div className="mt-6 rounded-md border border-ai-border bg-ai-bg p-3 text-xs leading-relaxed text-ai-text">
              <strong>Design principle</strong>
              <br />
              AI agents only draft and recommend. Rules and humans decide. Every action is logged.
            </div>
          </nav>
        </aside>
        <main className="min-w-0 flex-1 px-4 py-6 md:px-8">
          <Outlet />
        </main>
      </div>
      <Notices />
    </div>
  );
}
