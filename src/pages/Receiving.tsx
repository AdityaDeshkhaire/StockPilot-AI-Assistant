import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { db } from '../db/schema';
import { Button, Card, Chip, Empty, ErrorCard, PageHeader, StatusChip, TableWrap } from '../components/ui';
import { fmtDate, useMaps, useSimDate } from '../hooks';
import { performThreeWayMatch } from '../domain/match';
import { submitReceipt, type ReceiveLineInput } from '../services/workflow';
import { notify } from '../services/events';
import { useUser } from '../auth/session';
import type { GoodsReceipt, ReceiptLine } from '../domain/types';

export function Receiving() {
  const user = useUser();
  const today = useSimDate();
  const { vendor, product } = useMaps();
  const pos = useLiveQuery(() => db.purchase_orders.where('status').anyOf('Sent', 'Acknowledged', 'Partially_Received').toArray(), []) ?? [];
  const receipts = useLiveQuery(() => db.goods_receipts.reverse().limit(8).toArray(), []) ?? [];
  const [poId, setPoId] = useState('');
  const [scan, setScan] = useState('');
  const po = pos.find((p) => p.po_id === poId);
  const lines = useLiveQuery(() => db.po_lines.where('po_id').equals(poId).toArray(), [poId]) ?? [];
  const [inputs, setInputs] = useState<Record<string, ReceiveLineInput>>({});
  const [slip, setSlip] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const open = (id: string) => {
    const p = pos.find((x) => x.po_id === id.trim().toUpperCase());
    if (!p) return setErr(`No receivable PO "${id}". Check the number on the packing slip.`);
    setErr(null);
    setPoId(p.po_id);
    setSlip(p.asn?.packing_slip_no ?? '');
    setInputs({});
  };

  const val = (lineId: string): ReceiveLineInput => {
    const l = lines.find((x) => x.po_line_id === lineId)!;
    const asn = po?.asn?.lines.find((a) => a.po_line_id === lineId);
    return (
      inputs[lineId] ?? {
        po_line_id: lineId,
        qty_received: asn ? asn.qty_shipped : l.ordered_qty - l.received_qty,
        qty_damaged: 0,
        qty_wrong_item: asn?.qty_wrong_item ?? 0,
        condition_notes: '',
      }
    );
  };
  const set = (lineId: string, patch: Partial<ReceiveLineInput>) => setInputs({ ...inputs, [lineId]: { ...val(lineId), ...patch } });

  // Live match chips: run the same deterministic match on the current inputs.
  const preview = useMemo(() => {
    if (!po || lines.length === 0) return null;
    const r: GoodsReceipt = { receipt_id: 'preview', po_id: po.po_id, received_by: user.user_id, packing_slip_no: slip, received_at: today, status: 'Pending_Inspection' };
    const rls: ReceiptLine[] = lines.map((l) => {
      const v = val(l.po_line_id);
      return { receipt_line_id: l.po_line_id, receipt_id: 'preview', po_line_id: l.po_line_id, qty_received: v.qty_received, qty_accepted: 0, qty_damaged: v.qty_damaged, qty_wrong_item: v.qty_wrong_item, condition_notes: '' };
    });
    return performThreeWayMatch(r, rls, lines, po.asn);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [po, lines, inputs, slip]);

  const submit = async () => {
    if (!po) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await submitReceipt(po.po_id, user, slip, lines.map((l) => val(l.po_line_id)));
      notify({
        kind: r.discrepancies ? 'warning' : 'success',
        title: `Receipt ${r.receipt_id}: ${r.status.replace('_', ' ')}`,
        body: r.discrepancies ? `${r.discrepancies} discrepancy(ies) found — the Discrepancy agent drafted a vendor claim. Put-away tasks created.` : 'All lines matched. Put-away tasks created.',
      });
      setPoId('');
      setScan('');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Receiving" subtitle="Count what arrived. The three-way match (PO vs. count vs. ASN) runs automatically." />
      <Card title="Expected deliveries">
        {pos.length === 0 ? (
          <Empty>No deliveries expected.</Empty>
        ) : (
          <TableWrap>
            <table className="table">
              <thead>
                <tr>
                  <th>PO</th>
                  <th>Vendor</th>
                  <th>Expected</th>
                  <th>Status</th>
                  <th>Shipment</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {pos.map((p) => (
                  <tr key={p.po_id} className={p.expected_delivery_date <= today ? 'bg-sky-50/50' : ''}>
                    <td className="font-medium">{p.po_id}</td>
                    <td>{vendor(p.vendor_id)?.name}</td>
                    <td>
                      {fmtDate(p.expected_delivery_date)} {p.expected_delivery_date <= today && <Chip tone="blue">Today / due</Chip>}
                    </td>
                    <td>
                      <StatusChip status={p.status} />
                    </td>
                    <td>{p.asn ? <Chip tone="green">ASN {p.asn.packing_slip_no}</Chip> : <Chip>Not shipped</Chip>}</td>
                    <td className="text-right">
                      <Button variant="secondary" onClick={() => open(p.po_id)}>
                        Receive
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
        <form
          className="mt-4 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            open(scan);
          }}
        >
          <div>
            <label className="label">Scan / enter PO number</label>
            <input className="input w-48" value={scan} onChange={(e) => setScan(e.target.value)} placeholder="PO-1001" />
          </div>
          <Button type="submit" variant="secondary">
            Open
          </Button>
        </form>
      </Card>

      {err && <ErrorCard title="Cannot receive">{err}</ErrorCard>}

      {po && (
        <Card title={`Receive ${po.po_id} · ${vendor(po.vendor_id)?.name}`}>
          {po.asn?.note && <p className="mb-2 text-sm text-slate-600">ASN note: {po.asn.note}</p>}
          <div className="mb-3 max-w-xs">
            <label className="label">Packing slip #</label>
            <input className="input" value={slip} onChange={(e) => setSlip(e.target.value)} />
          </div>
          <TableWrap>
            <table className="table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="text-right">Open</th>
                  <th className="text-right">ASN</th>
                  <th className="text-right">Received</th>
                  <th className="text-right">Damaged</th>
                  <th className="text-right">Wrong item</th>
                  <th>Notes</th>
                  <th>Match</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => {
                  const v = val(l.po_line_id);
                  const m = preview?.lines.find((x) => x.po_line_id === l.po_line_id);
                  const asn = po.asn?.lines.find((a) => a.po_line_id === l.po_line_id);
                  return (
                    <tr key={l.po_line_id}>
                      <td className="font-medium">{product(l.product_id)?.name}</td>
                      <td className="text-right tabular-nums">{l.ordered_qty - l.received_qty}</td>
                      <td className="text-right tabular-nums text-slate-500">{asn ? asn.qty_shipped : '—'}</td>
                      <td className="text-right">
                        <input type="number" min={0} className="input w-20 text-right" value={v.qty_received} onChange={(e) => set(l.po_line_id, { qty_received: Number(e.target.value) })} />
                      </td>
                      <td className="text-right">
                        <input type="number" min={0} className="input w-20 text-right" value={v.qty_damaged} onChange={(e) => set(l.po_line_id, { qty_damaged: Number(e.target.value) })} />
                      </td>
                      <td className="text-right">
                        <input type="number" min={0} className="input w-20 text-right" value={v.qty_wrong_item} onChange={(e) => set(l.po_line_id, { qty_wrong_item: Number(e.target.value) })} />
                      </td>
                      <td>
                        <input className="input w-40" value={v.condition_notes} onChange={(e) => set(l.po_line_id, { condition_notes: e.target.value })} />
                      </td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          {m && m.flags.length === 0 && <Chip tone="green">Match</Chip>}
                          {m?.flags.map((f) => (
                            <span key={f.type} title={f.note}>
                              <StatusChip status={f.type} />
                            </span>
                          ))}
                        </div>
                        {m && <div className="mt-1 text-xs text-slate-500">Accept {m.qty_accepted}</div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
          {preview && preview.asnNotes.length > 0 && <p className="mt-2 text-xs text-amber-700">ASN: {preview.asnNotes.join(' · ')}</p>}
          <div className="mt-4 flex items-center justify-between gap-2">
            <span className="text-sm">
              Receipt status if submitted: {preview && <StatusChip status={preview.status} />}
            </span>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setPoId('')}>
                Cancel
              </Button>
              <Button busy={busy} onClick={submit}>
                Submit receipt
              </Button>
            </div>
          </div>
        </Card>
      )}

      {receipts.length > 0 && (
        <Card title="Recent receipts">
          <ul className="space-y-1 text-sm">
            {receipts.map((r) => (
              <li key={r.receipt_id}>
                <strong>{r.receipt_id}</strong> · {r.po_id} · slip {r.packing_slip_no} · <StatusChip status={r.status} />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
