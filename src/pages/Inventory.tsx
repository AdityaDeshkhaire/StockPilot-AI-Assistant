import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { db } from '../db/schema';
import { Button, Card, ErrorCard, Modal, PageHeader, StatusChip, TableWrap } from '../components/ui';
import { availableFor, daysOfCover, onHandFor, onOrderFor } from '../domain/util';
import { avgDailySalesMap, updateReorderSettings } from '../services/workflow';
import { useUser } from '../auth/session';
import type { Product } from '../domain/types';

export function InventoryPage() {
  const user = useUser();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [edit, setEdit] = useState<Product | null>(null);
  const data = useLiveQuery(async () => {
    const [products, inventory] = await Promise.all([db.products.toArray(), db.inventory.toArray()]);
    const avg = await avgDailySalesMap((await db.settings.get('sim_date'))?.value ?? '');
    return { products, inventory, avg };
  }, []);
  if (!data) return null;
  const cats = [...new Set(data.products.map((p) => p.category))];
  const rows = data.products.filter((p) => (!cat || p.category === cat) && (!q || `${p.name} ${p.sku}`.toLowerCase().includes(q.toLowerCase())));

  return (
    <div>
      <PageHeader title="Inventory" subtitle="On hand changes only through POS sales and confirmed put-away." />
      <Card>
        <div className="mb-3 flex flex-wrap gap-2">
          <input className="input max-w-xs" placeholder="Search name or SKU" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="input max-w-[12rem]" value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="">All categories</option>
            {cats.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
        <TableWrap>
          <table className="table">
            <thead>
              <tr>
                <th>Item</th>
                <th>On hand by bin</th>
                <th className="text-right">On hand</th>
                <th className="text-right">On order</th>
                <th className="text-right">ROP</th>
                <th className="text-right">Safety</th>
                <th className="text-right">Max</th>
                <th className="text-right">Avg/day</th>
                <th className="text-right">Days of cover</th>
                <th>Status</th>
                {user.role === 'Store_Manager' && <th />}
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const bins = data.inventory.filter((i) => i.product_id === p.product_id && i.qty_on_hand > 0);
                const avail = availableFor(p.product_id, data.inventory);
                const avg = data.avg[p.product_id] ?? 0;
                const cover = daysOfCover(avail, avg);
                const status = avail <= p.safety_stock ? 'Critical' : avail <= p.reorder_point ? 'Low' : 'OK';
                return (
                  <tr key={p.product_id}>
                    <td>
                      <div className="font-medium">{p.name}</div>
                      <div className="text-xs text-slate-500">
                        {p.sku} · {p.category} · case {p.case_pack}
                      </div>
                    </td>
                    <td className="text-xs">
                      {bins.length ? bins.map((b) => (
                        <div key={b.inventory_id} className="font-mono">
                          {b.bin_id}: {b.qty_on_hand}
                        </div>
                      )) : '—'}
                    </td>
                    <td className="text-right tabular-nums">{onHandFor(p.product_id, data.inventory)}</td>
                    <td className="text-right tabular-nums">{onOrderFor(p.product_id, data.inventory)}</td>
                    <td className="text-right tabular-nums">{p.reorder_point}</td>
                    <td className="text-right tabular-nums">{p.safety_stock}</td>
                    <td className="text-right tabular-nums">{p.max_stock}</td>
                    <td className="text-right tabular-nums">{avg.toFixed(1)}</td>
                    <td className="text-right tabular-nums">{Number.isFinite(cover) ? cover.toFixed(1) : '—'}</td>
                    <td>
                      <StatusChip status={status} />
                    </td>
                    {user.role === 'Store_Manager' && (
                      <td>
                        <Button variant="ghost" onClick={() => setEdit(p)}>
                          Edit
                        </Button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
      </Card>
      {edit && <EditModal p={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function EditModal({ p, onClose }: { p: Product; onClose: () => void }) {
  const user = useUser();
  const [f, setF] = useState({ reorder_point: p.reorder_point, safety_stock: p.safety_stock, max_stock: p.max_stock, review_cycle_days: p.review_cycle_days });
  const [err, setErr] = useState<string | null>(null);
  const fields: [keyof typeof f, string][] = [
    ['reorder_point', 'Reorder point'],
    ['safety_stock', 'Safety stock'],
    ['max_stock', 'Max stock'],
    ['review_cycle_days', 'Review cycle (days)'],
  ];
  const invalid = f.safety_stock > f.reorder_point || f.reorder_point >= f.max_stock;
  return (
    <Modal open onClose={onClose} title={`Reorder settings — ${p.name}`}>
      <div className="grid grid-cols-2 gap-3">
        {fields.map(([k, l]) => (
          <div key={k}>
            <label className="label">{l}</label>
            <input type="number" min={0} className="input" value={f[k]} onChange={(e) => setF({ ...f, [k]: Number(e.target.value) })} />
          </div>
        ))}
      </div>
      {invalid && <p className="mt-2 text-sm text-amber-700">Safety stock must be ≤ reorder point, and reorder point &lt; max stock.</p>}
      {err && <ErrorCard title="Not saved">{err}</ErrorCard>}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={invalid}
          onClick={async () => {
            try {
              await updateReorderSettings(user, p.product_id, f);
              onClose();
            } catch (e) {
              setErr(String(e));
            }
          }}
        >
          Save
        </Button>
      </div>
    </Modal>
  );
}
