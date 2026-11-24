import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { db } from '../db/schema';
import { Button, Empty } from '../components/ui';
import { useMaps } from '../hooks';
import { confirmPutaway } from '../services/workflow';
import { useUser } from '../auth/session';
import type { PutawayTask } from '../domain/types';

/** Mobile-style layout for the Stock Associate. */
export function Putaway() {
  const tasks = useLiveQuery(() => db.putaway_tasks.where('status').equals('Open').toArray(), []) ?? [];
  const done = useLiveQuery(() => db.putaway_tasks.where('status').equals('Completed').reverse().limit(5).toArray(), []) ?? [];
  const { product } = useMaps();
  const [active, setActive] = useState<PutawayTask | null>(null);

  return (
    <div className="mx-auto max-w-sm">
      <div className="overflow-hidden rounded-[2rem] border-8 border-slate-800 bg-slate-50 shadow-xl">
        <div className="bg-navy px-4 py-3 text-white">
          <div className="text-xs opacity-70">StockPilot Mobile</div>
          <div className="text-lg font-semibold">{active ? 'Confirm put-away' : `Put-away tasks (${tasks.length})`}</div>
        </div>
        <div className="min-h-[32rem] p-4">
          {active ? (
            <Confirm task={active} onDone={() => setActive(null)} />
          ) : tasks.length === 0 ? (
            <Empty>No open tasks. Tasks appear after the Receiving Clerk submits a receipt.</Empty>
          ) : (
            <ul className="space-y-2">
              {tasks.map((t) => (
                <li key={t.task_id}>
                  <button onClick={() => setActive(t)} className="w-full rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm active:bg-slate-100">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xl font-bold text-navy">{t.bin_id}</span>
                      <span className="text-lg font-semibold">×{t.qty}</span>
                    </div>
                    <div className="mt-1 text-sm text-slate-600">{product(t.product_id)?.name}</div>
                    <div className="text-xs text-slate-400">{t.task_id}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!active && done.length > 0 && (
            <div className="mt-6">
              <div className="label">Recently completed</div>
              <ul className="space-y-1 text-xs text-slate-500">
                {done.map((t) => (
                  <li key={t.task_id}>
                    ✓ {t.qty} × {product(t.product_id)?.name} → {t.bin_id}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Confirm({ task, onDone }: { task: PutawayTask; onDone: () => void }) {
  const user = useUser();
  const { product } = useMaps();
  const [scan, setScan] = useState('');
  const [qty, setQty] = useState(task.qty);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-navy p-5 text-center text-white">
        <div className="text-xs uppercase tracking-widest opacity-70">Go to bin</div>
        <div className="mt-1 font-mono text-5xl font-bold tracking-wider">{task.bin_id}</div>
      </div>
      <div className="text-center">
        <div className="font-semibold">{product(task.product_id)?.name}</div>
        <div className="text-sm text-slate-500">
          {task.qty} units · {product(task.product_id)?.sku}
        </div>
      </div>
      <div>
        <label className="label">Scan bin label (type the bin code)</label>
        <input autoFocus className="input py-3 text-center font-mono text-xl uppercase" value={scan} onChange={(e) => setScan(e.target.value)} placeholder="B-07-03" />
      </div>
      <div>
        <label className="label">Quantity placed</label>
        <input type="number" className="input py-3 text-center text-xl" value={qty} min={1} max={task.qty} onChange={(e) => setQty(Number(e.target.value))} />
      </div>
      {msg && <div className={`rounded-lg p-3 text-sm ${msg.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`}>{msg.ok ? '✓ ' : '⚠ '}{msg.text}</div>}
      <Button
        className="w-full py-3 text-base"
        busy={busy}
        onClick={async () => {
          setBusy(true);
          const r = await confirmPutaway(task.task_id, scan, qty, user);
          setBusy(false);
          setMsg({ ok: r.ok, text: r.message });
          if (r.ok) setTimeout(onDone, 1200);
        }}
      >
        Confirm put-away
      </Button>
      <Button variant="ghost" className="w-full" onClick={onDone}>
        ← Back to tasks
      </Button>
    </div>
  );
}
