import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, ErrorCard, PageHeader } from '../components/ui';
import { getSettings, updateSystemSettings } from '../services/workflow';
import { resetDemoData } from '../db/seed';
import { getAgentMode, setAgentMode, type AgentMode } from '../agents/client';
import { notify } from '../services/events';
import { useSession, useUser } from '../auth/session';
import type { SettingsMap } from '../domain/types';

export function Settings() {
  const user = useUser();
  const { logout } = useSession();
  const nav = useNavigate();
  const [s, setS] = useState<SettingsMap | null>(null);
  const [mode, setMode] = useState<AgentMode>(getAgentMode());
  const [confirmReset, setConfirmReset] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    getSettings().then(setS);
  }, []);
  if (!s) return null;

  return (
    <div className="space-y-5">
      <PageHeader title="Settings" subtitle="Control limits are set by people only — agents can never change them." />
      <Card title="Approval & matching rules">
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="label">Auto-approve limit (USD)</label>
            <input type="number" className="input" value={s.auto_approve_limit} onChange={(e) => setS({ ...s, auto_approve_limit: Number(e.target.value) })} />
          </div>
          <div>
            <label className="label">Vendor ack timeout (hours)</label>
            <input type="number" className="input" value={s.ack_timeout_hours} onChange={(e) => setS({ ...s, ack_timeout_hours: Number(e.target.value) })} />
          </div>
          <div>
            <label className="label">Match tolerance (%)</label>
            <input type="number" className="input" value={s.match_tolerance_pct} onChange={(e) => setS({ ...s, match_tolerance_pct: Number(e.target.value) })} />
          </div>
        </div>
        {err && <div className="mt-3"><ErrorCard title="Not saved">{err}</ErrorCard></div>}
        <div className="mt-4">
          <Button
            onClick={async () => {
              try {
                await updateSystemSettings(user, s);
                notify({ kind: 'success', title: 'Settings saved' });
              } catch (e) {
                setErr(String(e));
              }
            }}
          >
            Save settings
          </Button>
        </div>
      </Card>

      <Card title="AI agent mode">
        <p className="mb-3 text-sm text-slate-600">
          <strong>Mock</strong> returns realistic canned JSON (no API key). <strong>Live</strong> calls the Netlify function, which uses the Anthropic API with <code>ANTHROPIC_API_KEY</code>. Invalid live replies fall back to the rule-based result.
        </p>
        <div className="flex gap-2">
          {(['mock', 'live'] as AgentMode[]).map((m) => (
            <Button
              key={m}
              variant={mode === m ? 'primary' : 'secondary'}
              onClick={() => {
                setAgentMode(m);
                setMode(m);
                notify({ kind: 'info', title: `Agent mode: ${m}` });
              }}
            >
              {m === 'mock' ? 'Mock' : 'Live'}
            </Button>
          ))}
        </div>
      </Card>

      <Card title="Demo data">
        <p className="mb-3 text-sm text-slate-600">Erase everything in the in-browser database and reseed products, vendors, bins and 26 weeks of sales history.</p>
        {!confirmReset ? (
          <Button variant="danger" onClick={() => setConfirmReset(true)}>
            Reset demo data…
          </Button>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-sm text-red-700">This deletes all PRs, POs, receipts and logs.</span>
            <Button
              variant="danger"
              onClick={async () => {
                await resetDemoData();
                logout();
                nav('/login');
              }}
            >
              Yes, reset
            </Button>
            <Button variant="secondary" onClick={() => setConfirmReset(false)}>
              Cancel
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
