import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { db } from '../db/schema';
import { AIPanel, Button, Card, Chip, Empty, ErrorCard, PageHeader, StatusChip, TableWrap } from '../components/ui';
import { fmtDate, useMaps } from '../hooks';
import { usd } from '../domain/util';
import { cancelPO, canSendPO, decideFollowup, revisePO, sendPO, type VendorScore } from '../services/workflow';
import { notify } from '../services/events';
import { useUser } from '../auth/session';

export function POList() {
  const pos = useLiveQuery(() => db.purchase_orders.reverse().toArray(), []) ?? [];
  const { vendor, userName } = useMaps();
  return (
    <div>
      <PageHeader title="Purchase Orders" subtitle="Drafted by the Procurement agent from in-house vendor scores. Managers approve and send." />
      <Card>
        {pos.length === 0 ? (
          <Empty>No purchase orders yet. Approve a requisition to create one.</Empty>
        ) : (
          <TableWrap>
            <table className="table">
              <thead>
                <tr>
                  <th>PO</th>
                  <th>Vendor</th>
                  <th>PR</th>
                  <th>Order date</th>
                  <th>Expected</th>
                  <th className="text-right">Total</th>
                  <th>Status</th>
                  <th>Approved by</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {pos.map((po) => (
                  <tr key={po.po_id}>
                    <td className="font-medium">{po.po_id}</td>
                    <td>{vendor(po.vendor_id)?.name}</td>
                    <td>{po.pr_id}</td>
                    <td>{fmtDate(po.order_date)}</td>
                    <td>{fmtDate(po.expected_delivery_date)}</td>
                    <td className="text-right tabular-nums">{usd(po.total_amount)}</td>
                    <td>
                      <StatusChip status={po.status} /> {po.asn && <Chip tone="blue">Shipped</Chip>}
                    </td>
                    <td>{po.approved_by ? userName(po.approved_by) : '—'}</td>
                    <td className="text-right">
                      <Link className="font-medium text-navy hover:underline" to={`/purchase-orders/${po.po_id}`}>
                        Open →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </div>
  );
}

export function PODetail() {
  const { id = '' } = useParams();
  const user = useUser();
  const { product, vendor, userName } = useMaps();
  const po = useLiveQuery(() => db.purchase_orders.get(id), [id]);
  const lines = useLiveQuery(() => db.po_lines.where('po_id').equals(id).toArray(), [id]) ?? [];
  const [email, setEmail] = useState('');
  const [instr, setInstr] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (po) setEmail(po.order_email);
  }, [po?.order_email]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!po) return null;
  const v = vendor(po.vendor_id);
  const scores: { product_id: string; scores: VendorScore[]; chosen: string | null }[] = po.score_snapshot ? JSON.parse(po.score_snapshot) : [];
  const block = canSendPO(po, user);
  const isDraft = po.status === 'Draft';

  const act = async (name: string, fn: () => Promise<void>) => {
    setBusy(name);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
    setBusy(null);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title={`Purchase Order ${po.po_id}`}
        subtitle={`${v?.name} · from ${po.pr_id} · expected ${fmtDate(po.expected_delivery_date)}`}
        actions={
          <Link to="/purchase-orders" className="text-sm text-navy hover:underline">
            ← All purchase orders
          </Link>
        }
      />
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <StatusChip status={po.status} />
        {po.approved_by && <span>Approved by {userName(po.approved_by)}</span>}
        {po.tracking_number && <span>Tracking {po.tracking_number}</span>}
        {po.acknowledged_at && <span>Acknowledged {fmtDate(po.acknowledged_at)}</span>}
      </div>

      <Card title="Vendor scores per line" actions={<span className="text-xs text-slate-500">Score = 0.4·price + 0.3·lead + 0.2·on-time + 0.1·rating×20 · −25 if lead time &gt; days of cover</span>}>
        <div className="space-y-4">
          {scores.map((s) => (
            <div key={s.product_id}>
              <div className="mb-1 text-sm font-semibold">{product(s.product_id)?.name}</div>
              <TableWrap>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Vendor</th>
                      <th className="text-right">Unit price</th>
                      <th className="text-right">Lead (days)</th>
                      <th className="text-right">On-time</th>
                      <th className="text-right">Rating</th>
                      <th className="text-right">Price pts</th>
                      <th className="text-right">Lead pts</th>
                      <th className="text-right">Score</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {s.scores.map((x) => (
                      <tr key={x.vendor_id} className={x.vendor_id === s.chosen ? 'bg-emerald-50/60' : ''}>
                        <td className="font-medium">
                          {x.vendor_name} {x.is_preferred && <Chip tone="navy">Preferred</Chip>}
                        </td>
                        <td className="text-right tabular-nums">{usd(x.unit_price)}</td>
                        <td className="text-right tabular-nums">{x.lead_time_days}</td>
                        <td className="text-right tabular-nums">{x.on_time_rate}%</td>
                        <td className="text-right tabular-nums">{x.rating.toFixed(1)}</td>
                        <td className="text-right tabular-nums">{x.price_score.toFixed(1)}</td>
                        <td className="text-right tabular-nums">{x.lead_score.toFixed(1)}</td>
                        <td className="text-right font-semibold tabular-nums">{x.score.toFixed(1)}</td>
                        <td>
                          {x.vendor_id === s.chosen && <Chip tone="green">Selected</Chip>} {x.stockout_risk && <Chip tone="red">Stock-out risk −25</Chip>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            </div>
          ))}
        </div>
      </Card>

      <AIPanel title="Procurement agent — selection note">
        <p>{po.selection_note}</p>
      </AIPanel>

      <Card title="Lines">
        <TableWrap>
          <table className="table">
            <thead>
              <tr>
                <th>Item</th>
                <th className="text-right">Ordered</th>
                <th className="text-right">Received</th>
                <th className="text-right">Unit price</th>
                <th className="text-right">Line total</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.po_line_id}>
                  <td>{product(l.product_id)?.name}</td>
                  <td className="text-right tabular-nums">{l.ordered_qty}</td>
                  <td className="text-right tabular-nums">{l.received_qty}</td>
                  <td className="text-right tabular-nums">{usd(l.unit_price)}</td>
                  <td className="text-right tabular-nums">{usd(l.ordered_qty * l.unit_price)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4} className="px-3 py-2 text-right font-semibold">
                  Total
                </td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums">{usd(po.total_amount)}</td>
              </tr>
            </tfoot>
          </table>
        </TableWrap>
      </Card>

      <AIPanel title={isDraft ? 'Order email (AI draft — edit before sending)' : 'Order email as sent'}>
        {isDraft ? (
          <textarea className="input mt-1 font-mono text-xs text-slate-800" rows={16} value={email} onChange={(e) => setEmail(e.target.value)} />
        ) : (
          <pre className="whitespace-pre-wrap font-mono text-xs text-slate-800">{po.order_email}</pre>
        )}
      </AIPanel>

      {err && <ErrorCard title="Action blocked">{err}</ErrorCard>}

      {isDraft && (
        <Card>
          {block && <p className="mb-3 text-sm text-amber-700">⚠ {block}</p>}
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[16rem] flex-1">
              <label className="label">Ask agent to revise the wording</label>
              <input className="input" value={instr} onChange={(e) => setInstr(e.target.value)} placeholder="e.g. Ask for delivery before 7 am; mention dock 2" />
            </div>
            <Button variant="ai" disabled={!instr.trim()} busy={busy === 'revise'} onClick={() => act('revise', async () => {
              await revisePO(po.po_id, instr);
              setInstr('');
            })}>
              ✦ Ask agent to revise
            </Button>
            <Button busy={busy === 'send'} disabled={!!block} onClick={() => act('send', async () => {
              await sendPO(po.po_id, user, email);
              notify({ kind: 'success', title: `${po.po_id} sent to ${v?.name}`, body: 'Quantities now count as on order.' });
            })}>
              Approve &amp; send
            </Button>
            <Button variant="secondary" busy={busy === 'cancel'} onClick={() => act('cancel', () => cancelPO(po.po_id, user))}>
              Cancel PO
            </Button>
          </div>
        </Card>
      )}

      {po.vendor_note && (
        <Card title="Vendor note">
          <p className="text-sm">{po.vendor_note}</p>
        </Card>
      )}

      {po.followup_email && !po.followup_email.startsWith('(') && (
        <AIPanel title={`Vendor Expediting agent — follow-up draft${po.followup_escalate ? ' (recommends escalation)' : ''}`}>
          <pre className="whitespace-pre-wrap font-mono text-xs text-slate-800">{po.followup_email}</pre>
          <div className="mt-3 flex gap-2">
            <Button onClick={() => decideFollowup(po.po_id, user, true)}>Send follow-up</Button>
            <Button variant="secondary" onClick={() => decideFollowup(po.po_id, user, false)}>
              Dismiss
            </Button>
          </div>
        </AIPanel>
      )}

      {po.asn && (
        <Card title="Advance ship notice (ASN)">
          <div className="text-sm">
            Shipped {fmtDate(po.asn.shipped_at)} · packing slip {po.asn.packing_slip_no} · mode <Chip>{po.asn.mode.replace('_', ' ')}</Chip>
            {po.asn.note && <p className="mt-1 text-slate-600">Note: {po.asn.note}</p>}
          </div>
        </Card>
      )}
    </div>
  );
}
