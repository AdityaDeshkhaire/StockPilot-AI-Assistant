import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../auth/session';
import { db } from '../db/schema';
import { HOME } from '../components/Layout';
import { Button } from '../components/ui';

const DEMO = [
  { role: 'Store Manager', email: 'manager@stockpilot.demo' },
  { role: 'Receiving Clerk', email: 'clerk@stockpilot.demo' },
  { role: 'Stock Associate', email: 'associate@stockpilot.demo' },
  { role: 'Vendor (simulator)', email: 'vendor@stockpilot.demo' },
  { role: 'Regional Manager', email: 'regional@stockpilot.demo' },
];

export function Login() {
  const { login } = useSession();
  const nav = useNavigate();
  const [email, setEmail] = useState('manager@stockpilot.demo');
  const [password, setPassword] = useState('demo123');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const err = await login(email, password);
    setBusy(false);
    if (err) return setError(err);
    const u = await db.users.where('email').equalsIgnoreCase(email.trim()).first();
    nav(u ? HOME[u.role] : '/');
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-navy to-navy-dark p-4">
      <div className="grid w-full max-w-4xl overflow-hidden rounded-2xl bg-white shadow-2xl md:grid-cols-2">
        <div className="hidden flex-col justify-between bg-navy p-8 text-white md:flex">
          <div>
            <div className="flex items-center gap-2 text-2xl font-semibold">
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-white/15">SP</span>
              StockPilot
            </div>
            <p className="mt-4 text-white/80">Agentic AI-assisted inventory management — from purchase request to put-away.</p>
          </div>
          
          <p className="text-xs text-white/50">MIS 6308 · Fall 2026 · Final Project Prototype</p>
        </div>
        <form onSubmit={submit} className="p-8">
          <h1>Sign in</h1>
          <p className="mt-1 text-sm text-slate-500">Use a demo account below.</p>
          <div className="mt-6 space-y-4">
            <div>
              <label className="label" htmlFor="email">
                Email
              </label>
              <input id="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
            </div>
            <div>
              <label className="label" htmlFor="pw">
                Password
              </label>
              <input id="pw" type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            </div>
            {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
            <Button type="submit" busy={busy} className="w-full">
              Sign in
            </Button>
          </div>
          <div className="mt-6">
            <div className="label">Demo accounts (password: demo123)</div>
            <div className="grid gap-1.5">
              {DEMO.map((d) => (
                <button
                  type="button"
                  key={d.email}
                  onClick={() => {
                    setEmail(d.email);
                    setPassword('demo123');
                    setError(null);
                  }}
                  className={`flex justify-between rounded-md border px-3 py-1.5 text-left text-sm hover:bg-slate-50 ${email === d.email ? 'border-navy bg-navy/5' : 'border-slate-200'}`}
                >
                  <span className="font-medium">{d.role}</span>
                  <span className="text-slate-500">{d.email}</span>
                </button>
              ))}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
