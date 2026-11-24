import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import { db } from '../db/schema';
import { AIPanel, Button, Card, Chip, Empty, ErrorCard, Modal, PageHeader, StatusChip, TableWrap } from '../components/ui';
import { fmtDate, useMaps } from '../hooks';
import { round2, usd } from '../domain/util';
import { approvePR, canApprovePR, createManualPR, rejectPR, savePREdits } from '../services/workflow';
import { notify } from '../services/events';
import { useUser } from '../auth/session';

export function ReplenishmentList() {
  const prs = useLiveQuery(() => db.purchase_requisitions.orderBy('created_at').reverse().toArray(), []) ?? [];
  const lines = useLiveQuery(() => db.pr_lines.toArray(), []) ?? [];
  const { userName } = useMaps();
  const [manual, setManual] = useState(false);

  return (
    <div>
      <PageHeader
        title="Replenishment"
        subtitle="Purchase requisitions drafted by the Replenishment Planner agent and routed by approval rules."
        actions={<Button variant="secondary" onClick={() => setManual(true)}>+ Manual requisition</Button>}
      />
      <Card>
        {prs.length === 0 ? (
          <Empty>No requisitions yet. Run a POS day from the dashboard to let stock fall below reorder points.</Empty>
        ) : (
          <TableWrap>
            <table className="table">
              <thead>
                <tr>
                  <th>PR</th>
                  <th>Created</th>
                  <th>Source</th>
                  <th className="text-right">Lines</th>
                  <th className="text-right">Est. total</th>
                  <th>Status</th>
                  <th>Approver</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {prs.map((pr) => (
                  <tr key={pr.pr_id}>
                    <td className="font-medium">
                      {pr.pr_id} {pr.ai_generated && <Chip tone="purple">AI</Chip>}
                    </td>
                    <td>{fmtDate(pr.created_at)}</td>
                    <td>
                      <StatusChip status={pr.source} />
                    </td>
                    <td className="text-right">{lines.filter((l) => l.pr_id === pr.pr_id).length}</td>
                    <td className="text-right tabular-nums">{usd(pr.est_total_cost)}</td>
                    <td>
                      <StatusChip status={pr.status} />
                    </td>
                    <td>{pr.approved_by ? userName(pr.approved_by) : pr.assigned_approver ? `→ ${userName(pr.assigned_approver)}` : '—'}</td>
                    <td className="text-right">
                      <Link className="font-medium text-navy hover:underline" to={`/replenishment/${pr.pr_id}`}>
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
      <ManualPRModal open={manual} onClose={() => setManual(false)} />
    </div>
  );
}

function ManualPRModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const user = useUser();
  const { products } = useMaps();
  const nav = useNavigate();
  const [pid, setPid] = useState('');
  const [qty, setQty] = useState(12);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal open={open} onClose={onClose} title="Manual purchase requisition">
      <div className="space-y-3">
        <p className="text-sm text-slate-500">Manual requisitions always need approval, and you cannot approve one you created (segregation of duties).</p>
        <div>
          <label className="label">Product</label>
          <select className="input" value={pid} onChange={(e) => setPid(e.target.value)}>
            <option value="">Select…</option>
            {products.map((p) => (
              <option key={p.product_id} value={p.product_id}>
                {p.name} ({p.sku})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Quantity (rounded up to case pack)</label>
          <input type="number" min={1} className="input" value={qty} onChange={(e) => setQty(Number(e.target.value))} />
        </div>
        <div>
          <label className="label">Reason</label>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Community event order" />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!pid || qty < 1}
            busy={busy}
            onClick={async () => {
              setBusy(true);
              const id = await createManualPR(user, [{ product_id: pid, qty }], note);
              setBusy(false);
              onClose();
              nav(`/replenishment/${id}`);
            }}
          >
            Submit requisition
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function PRDetail() {
  const { id = '' } = useParams();
  const user = useUser();
  const nav = useNavigate();
  const { product, userName } = useMaps();
  const pr = useLiveQuery(() => db.purchase_requisitions.get(id), [id]);
  const lines = useLiveQuery(() => db.pr_lines.where('pr_id').equals(id).toArray(), [id]) ?? [];
  const pos = useLiveQuery(() => db.purchase_orders.where('pr_id').equals(id).toArray(), [id]) ?? [];
  const [qtys, setQtys] = useState<Record<string, number>>({});
  const [comment, setComment] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setQtys(Object.fromEntries(lines.map((l) => [l.pr_line_id, l.requested_qty])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines.map((l) => `${l.pr_line_id}:${l.requested_qty}`).join(',')]);

  const total = useMemo(() => round2(lines.reduce((s, l) => s + (qtys[l.pr_line_id] ?? l.requested_qty) * l.est_unit_cost, 0)), [lines, qtys]);
  if (!pr) return null;
  const editable = pr.status === 'Pending_Approval' || pr.status === 'Escalated';
  const block = canApprovePR({ ...pr, est_total_cost: total }, user);

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
        title={`Requisition ${pr.pr_id}`}
        subtitle={`Created ${fmtDate(pr.created_at)} by ${pr.created_by ? userName(pr.created_by) : 'Replenishment Planner agent'} · source ${pr.source.replace('_', ' ')}`}
        actions={
          <Link to="/replenishment" className="text-sm text-navy hover:underline">
            ← All requisitions
          </Link>
        }
      />
      <div className="flex flex-wrap items-center gap-3">
        <StatusChip status={pr.status} />
        {pr.assigned_approver && pr.status !== 'Approved' && pr.status !== 'Converted' && (
          <span className="text-sm text-slate-600">Routed to {userName(pr.assigned_approver)}</span>
        )}
        {pr.approved_by && (
          <span className="text-sm text-slate-600">
            Decided by {userName(pr.approved_by)} on {fmtDate(pr.approved_at)}
          </span>
        )}
      </div>

      {pr.ai_rationale && (
        <AIPanel title="Replenishment Planner rationale">
          <p>{pr.ai_rationale}</p>
        </AIPanel>
      )}
      {pr.manager_comments && <div className="rounded-md border border-slate-200 bg-white p-3 text-sm"><strong>Comments / flags:</strong> {pr.manager_comments}</div>}

      <Card title="Lines">
        <TableWrap>
          <table className="table">
            <thead>
              <tr>
                <th>Item</th>
                <th className="text-right">Qty</th>
                <th className="text-right">Case</th>
                <th className="text-right">Est. unit cost</th>
                <th className="text-right">Line total</th>
                <th>Confidence</th>
                <th className="w-[36%]">AI rationale</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const p = product(l.product_id);
                const q = qtys[l.pr_line_id] ?? l.requested_qty;
                return (
                  <tr key={l.pr_line_id}>
                    <td>
                      <div className="font-medium">{p?.name}</div>
                      <div className="text-xs text-slate-500">
                        {p?.sku} · max {p?.max_stock}
                      </div>
                    </td>
                    <td className="text-right">
                      {editable ? (
                        <input
                          type="number"
                          min={0}
                          step={p?.case_pack ?? 1}
                          className={`input w-24 text-right ${q !== l.requested_qty ? 'border-amber-400 bg-amber-50' : ''}`}
                          value={q}
                          onChange={(e) => setQtys({ ...qtys, [l.pr_line_id]: Number(e.target.value) })}
                        />
                      ) : (
                        <span className="tabular-nums">{l.requested_qty}</span>
                      )}
                    </td>
                    <td className="text-right text-slate-500">{p?.case_pack}</td>
                    <td className="text-right tabular-nums">{usd(l.est_unit_cost)}</td>
                    <td className="text-right tabular-nums">{usd(q * l.est_unit_cost)}</td>
                    <td>
                      <Chip tone={l.confidence === 'High' ? 'green' : l.confidence === 'Medium' ? 'amber' : 'red'}>{l.confidence}</Chip>
                    </td>
                    <td className="text-xs text-ai-text">{l.rationale}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4} className="px-3 py-2 text-right font-semibold">
                  Total
                </td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums">{usd(total)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </TableWrap>
      </Card>

      {err && <ErrorCard title="Action blocked">{err}</ErrorCard>}

      {editable && (
        <Card>
          {block && <p className="mb-3 text-sm text-amber-700">⚠ {block}</p>}
          {rejecting && (
            <div className="mb-3">
              <label className="label">Reason for rejection (required)</label>
              <textarea className="input" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button busy={busy === 'approve'} disabled={!!block} onClick={() => act('approve', async () => {
              await approvePR(pr.pr_id, user, qtys, comment);
              notify({ kind: 'success', title: `${pr.pr_id} approved`, body: 'Procurement agent drafted purchase order(s).' });
              const first = await db.purchase_orders.where('pr_id').equals(pr.pr_id).first();
              if (first) nav(`/purchase-orders/${first.po_id}`);
            })}>
              Approve
            </Button>
            <Button variant="secondary" busy={busy === 'save'} onClick={() => act('save', async () => {
              await savePREdits(pr.pr_id, qtys);
              notify({ kind: 'success', title: 'Edits saved' });
            })}>
              Save edits
            </Button>
            {!rejecting ? (
              <Button variant="danger" onClick={() => setRejecting(true)}>
                Reject…
              </Button>
            ) : (
              <Button variant="danger" busy={busy === 'reject'} disabled={!comment.trim()} onClick={() => act('reject', async () => {
                await rejectPR(pr.pr_id, user, comment);
                setRejecting(false);
              })}>
                Confirm reject
              </Button>
            )}
          </div>
        </Card>
      )}

      {pos.length > 0 && (
        <Card title="Purchase orders created from this requisition">
          <ul className="space-y-1 text-sm">
            {pos.map((po) => (
              <li key={po.po_id}>
                <Link className="font-medium text-navy hover:underline" to={`/purchase-orders/${po.po_id}`}>
                  {po.po_id}
                </Link>{' '}
                · {usd(po.total_amount)} <StatusChip status={po.status} />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
