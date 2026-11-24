import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { db } from '../db/schema';
import { Button, Card, Chip, Empty, PageHeader, StatusChip, TableWrap } from '../components/ui';
import { fmtDate, useMaps } from '../hooks';
import { usd } from '../domain/util';
import type { POLine, PurchaseOrder, ShipMode } from '../domain/types';
import { vendorAcknowledge, vendorShip } from '../services/workflow';
import { notify } from '../services/events';

export function VendorSimulator() {
  const pos = useLiveQuery(() => db.purchase_orders.where('status').anyOf('Sent', 'Acknowledged').toArray(), []) ?? [];
  const allLines = useLiveQuery(() => db.po_lines.toArray(), []) ?? [];
  const open = pos.filter((p) => !p.asn);
  const shipped = pos.filter((p) => p.asn);
  return (
    <div className="space-y-5">
      <PageHeader title="Vendor simulator" subtitle="Plays the vendor side: acknowledge purchase orders and ship them — in full or with problems." />
      {open.length === 0 && <Empty>No open purchase orders waiting on a vendor. Approve and send a PO as the Store Manager first.</Empty>}
      {open.map((po) => (
        <VendorPOCard key={po.po_id} po={po} lines={allLines.filter((l) => l.po_id === po.po_id)} />
      ))}
      {shipped.length > 0 && (
        <Card title="Shipped — awaiting receipt">
          <ul className="space-y-1 text-sm">
            {shipped.map((po) => (
              <li key={po.po_id}>
                <strong>{po.po_id}</strong> · tracking {po.tracking_number} · <Chip>{po.asn!.mode.replace('_', ' ')}</Chip>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

type Qty = Record<string, { shipped: number; damaged: number; wrong: number }>;

function VendorPOCard({ po, lines }: { po: PurchaseOrder; lines: POLine[] }) {
  const { vendor, product } = useMaps();
  const full = (): Qty => Object.fromEntries(lines.map((l) => [l.po_line_id, { shipped: l.ordered_qty - l.received_qty, damaged: 0, wrong: 0 }]));
  const [qty, setQty] = useState<Qty>(full);
  const [mode, setMode] = useState<ShipMode>('full');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const preset = (m: ShipMode, short: number, damaged: number) => {
    const q = full();
    const first = lines[0];
    if (first) {
      if (m === 'wrong_item') {
        const half = Math.floor(q[first.po_line_id].shipped / 2);
        q[first.po_line_id] = { shipped: q[first.po_line_id].shipped - half, damaged: 0, wrong: half };
      } else {
        q[first.po_line_id] = { shipped: q[first.po_line_id].shipped - short, damaged, wrong: 0 };
      }
    }
    setMode(m);
    setQty(q);
  };

  const set = (id: string, k: 'shipped' | 'damaged' | 'wrong', v: number) => setQty({ ...qty, [id]: { ...qty[id], [k]: Math.max(0, v) } });

  return (
    <Card
      title={
        <span>
          {po.po_id} · {vendor(po.vendor_id)?.name}
        </span>
      }
      actions={<StatusChip status={po.status} />}
    >
      <div className="mb-3 text-sm text-slate-600">
        Ordered {fmtDate(po.order_date)} · due {fmtDate(po.expected_delivery_date)} · {usd(po.total_amount)}
      </div>
      {po.status === 'Sent' && (
        <div className="mb-4 flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-3">
          <div className="min-w-[16rem] flex-1">
            <label className="label">Acknowledgement note (optional, parsed by the Expediting agent as data)</label>
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Confirmed. Truck arrives 2026-11-19 before noon." />
          </div>
          <Button
            busy={busy === 'ack'}
            onClick={async () => {
              setBusy('ack');
              await vendorAcknowledge(po.po_id, note);
              setBusy(null);
              notify({ kind: 'success', title: `${po.po_id} acknowledged` });
            }}
          >
            Acknowledge PO
          </Button>
        </div>
      )}

      <div className="mb-2 flex flex-wrap gap-2">
        <span className="label self-center">Ship preset (first line):</span>
        <Button variant={mode === 'full' ? 'primary' : 'secondary'} onClick={() => preset('full', 0, 0)}>
          Full
        </Button>
        <Button variant={mode === 'short' ? 'primary' : 'secondary'} onClick={() => preset('short', 12, 0)}>
          Short 12
        </Button>
        <Button variant={mode === 'damaged' ? 'primary' : 'secondary'} onClick={() => preset('damaged', 0, 12)}>
          12 damaged
        </Button>
        <Button variant="secondary" onClick={() => preset('short', 12, 12)}>
          Short 12 + 12 damaged
        </Button>
        <Button variant={mode === 'wrong_item' ? 'primary' : 'secondary'} onClick={() => preset('wrong_item', 0, 0)}>
          Wrong item
        </Button>
      </div>
      <TableWrap>
        <table className="table">
          <thead>
            <tr>
              <th>Item</th>
              <th className="text-right">Open qty</th>
              <th className="text-right">Qty shipped (correct item)</th>
              <th className="text-right">Of which damaged</th>
              <th className="text-right">Wrong item units</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.po_line_id}>
                <td>{product(l.product_id)?.name}</td>
                <td className="text-right tabular-nums">{l.ordered_qty - l.received_qty}</td>
                <td className="text-right">
                  <input type="number" className="input w-24 text-right" value={qty[l.po_line_id]?.shipped ?? 0} onChange={(e) => set(l.po_line_id, 'shipped', Number(e.target.value))} />
                </td>
                <td className="text-right">
                  <input type="number" className="input w-20 text-right" value={qty[l.po_line_id]?.damaged ?? 0} onChange={(e) => set(l.po_line_id, 'damaged', Number(e.target.value))} />
                </td>
                <td className="text-right">
                  <input type="number" className="input w-20 text-right" value={qty[l.po_line_id]?.wrong ?? 0} onChange={(e) => set(l.po_line_id, 'wrong', Number(e.target.value))} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
      <div className="mt-3 flex justify-end">
        <Button
          busy={busy === 'ship'}
          onClick={async () => {
            setBusy('ship');
            const hasIssue = Object.values(qty).some((q) => q.damaged || q.wrong) || lines.some((l) => (qty[l.po_line_id]?.shipped ?? 0) < l.ordered_qty - l.received_qty);
            await vendorShip(po.po_id, hasIssue && mode === 'full' ? 'short' : mode, qty, '');
            setBusy(null);
            notify({ kind: 'success', title: `${po.po_id} shipped`, body: 'ASN created. Switch to the Receiving Clerk to receive it.' });
          }}
        >
          Ship &amp; send ASN
        </Button>
      </div>
    </Card>
  );
}
