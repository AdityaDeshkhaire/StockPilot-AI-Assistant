import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { useState } from 'react';
import { db } from '../db/schema';
import { AIPanel, Button, Card, Chip, Empty, Kpi, Modal, PageHeader, StatusChip, TableWrap } from '../components/ui';
import { fmtDate, useMaps, useSimDate } from '../hooks';
import { availableFor, daysOfCover, onHandFor, onOrderFor, usd } from '../domain/util';
import { avgDailySalesMap, decideLog, runPosDay, weeklyInsights } from '../services/workflow';
import { notify } from '../services/events';
import { useUser } from '../auth/session';
import type { InsightsOutput } from '../agents/schemas';

export function Dashboard() {
  const user = useUser();
  const date = useSimDate();
  const { product, vendor } = useMaps();
  const [busy, setBusy] = useState(false);
  const [insight, setInsight] = useState<(InsightsOutput & { source: string; error?: string; entity_id: string }) | null>(null);
  const [insBusy, setInsBusy] = useState(false);

  const data = useLiveQuery(async () => {
    const [products, inventory, prs, pos, discs, log, tasks] = await Promise.all([
      db.products.toArray(),
      db.inventory.toArray(),
      db.purchase_requisitions.toArray(),
      db.purchase_orders.toArray(),
      db.discrepancies.toArray(),
      db.agent_action_log.orderBy('created_at').reverse().limit(10).toArray(),
      db.putaway_tasks.where('status').equals('Open').count(),
    ]);
    const today = (await db.settings.get('sim_date'))?.value ?? '';
    const avg = await avgDailySalesMap(today);
    const stock = products.map((p) => {
      const available = availableFor(p.product_id, inventory);
      return {
        p,
        on_hand: onHandFor(p.product_id, inventory),
        on_order: onOrderFor(p.product_id, inventory),
        available,
        cover: daysOfCover(available, avg[p.product_id] ?? 0),
        status: available <= p.safety_stock ? 'Critical' : available <= p.reorder_point ? 'Low' : 'OK',
      };
    });
    return { stock, prs, pos, discs, log, tasks };
  }, []);

  if (!data) return null;
  const below = data.stock.filter((s) => s.status !== 'OK');
  const watch = data.stock
    .filter((s) => s.available <= s.p.reorder_point * 1.3)
    .sort((a, b) => a.available / a.p.reorder_point - b.available / b.p.reorder_point);
  const awaiting = data.prs.filter((p) => p.status === 'Pending_Approval' || p.status === 'Escalated');
  const inTransit = data.pos.filter((p) => ['Sent', 'Acknowledged', 'Partially_Received'].includes(p.status));
  const draftPOs = data.pos.filter((p) => p.status === 'Draft');
  const openDisc = data.discs.filter((d) => d.resolution === 'Pending');
  const openClaims = [...new Set(openDisc.map((d) => d.receipt_id))];
  const followups = data.pos.filter((p) => p.followup_email && !p.followup_email.startsWith('('));

  const pos = async () => {
    setBusy(true);
    try {
      const r = await runPosDay();
      notify({
        kind: r.newPRs.length ? 'info' : 'success',
        title: `POS day ${fmtDate(r.date)} processed`,
        body: `${r.units} units sold.${r.newPRs.length ? ` Replenishment agent drafted ${r.newPRs.join(', ')}.` : ' No items crossed their reorder point.'}`,
      });
    } catch (e) {
      notify({ kind: 'error', title: 'POS day failed', body: String(e) });
    }
    setBusy(false);
  };

  const summary = async () => {
    setInsBusy(true);
    const r = await weeklyInsights();
    setInsight({ ...r.data, source: r.source, error: r.error, entity_id: r.entity_id });
    setInsBusy(false);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Good morning, ${user.first_name}`}
        subtitle={`Business date ${fmtDate(date)} — each “Run POS day” closes the register for the day and advances the date.`}
        actions={
          <>
            <Button variant="ai" onClick={summary} busy={insBusy}>
              ✦ Weekly summary
            </Button>
            <Button onClick={pos} busy={busy}>
              ▶ Run POS day
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi label="Items below ROP" value={below.length} tone={below.length ? 'red' : 'green'} hint="On hand + on order ≤ reorder point" />
        <Kpi label="PRs awaiting approval" value={awaiting.length} tone={awaiting.length ? 'amber' : 'navy'} />
        <Kpi label="POs in transit" value={inTransit.length} />
        <Kpi label="Open discrepancies" value={openDisc.length} tone={openDisc.length ? 'red' : 'navy'} />
      </div>

      <div className="grid gap-6 xl:grid-cols-5">
        <Card className="xl:col-span-3" title="Low-stock watch" actions={<Link className="text-sm text-navy hover:underline" to="/inventory">All inventory →</Link>}>
          {watch.length === 0 ? (
            <Empty>All items are comfortably above their reorder points. Run a POS day to simulate sales.</Empty>
          ) : (
            <TableWrap>
              <table className="table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th className="text-right">On hand</th>
                    <th className="text-right">On order</th>
                    <th className="text-right">ROP</th>
                    <th className="text-right">Days of cover</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {watch.map((s) => (
                    <tr key={s.p.product_id} className={s.status !== 'OK' ? 'bg-red-50/40' : ''}>
                      <td>
                        <div className="font-medium">{s.p.name}</div>
                        <div className="text-xs text-slate-500">
                          {s.p.sku} · {s.p.category}
                        </div>
                      </td>
                      <td className="text-right tabular-nums">{s.on_hand}</td>
                      <td className="text-right tabular-nums">{s.on_order}</td>
                      <td className="text-right tabular-nums">{s.p.reorder_point}</td>
                      <td className="text-right tabular-nums">{Number.isFinite(s.cover) ? s.cover.toFixed(1) : '—'}</td>
                      <td>
                        {s.status === 'OK' ? <Chip tone="amber">Watch</Chip> : <StatusChip status={s.status} />}
                        {s.on_order > 0 && (
                          <span className="ml-1">
                            <Chip tone="blue">On order</Chip>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>

        <Card className="xl:col-span-2" title="Needs your decision">
          <ul className="space-y-2 text-sm">
            {awaiting.map((pr) => (
              <li key={pr.pr_id} className="flex items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2">
                <span>
                  <strong>{pr.pr_id}</strong> requisition · {usd(pr.est_total_cost)} <StatusChip status={pr.status} />
                </span>
                <Link className="font-medium text-navy hover:underline" to={`/replenishment/${pr.pr_id}`}>
                  Review →
                </Link>
              </li>
            ))}
            {draftPOs.map((po) => (
              <li key={po.po_id} className="flex items-center justify-between gap-2 rounded-md border border-slate-200 px-3 py-2">
                <span>
                  <strong>{po.po_id}</strong> draft PO · {vendor(po.vendor_id)?.name} · {usd(po.total_amount)}
                </span>
                <Link className="font-medium text-navy hover:underline" to={`/purchase-orders/${po.po_id}`}>
                  Send →
                </Link>
              </li>
            ))}
            {openClaims.map((rid) => (
              <li key={rid} className="flex items-center justify-between gap-2 rounded-md border border-red-200 bg-red-50/50 px-3 py-2">
                <span>
                  <strong>{rid}</strong> receipt discrepancy claim
                </span>
                <Link className="font-medium text-navy hover:underline" to={`/discrepancies?receipt=${rid}`}>
                  Review →
                </Link>
              </li>
            ))}
            {followups.map((po) => (
              <li key={po.po_id} className="flex items-center justify-between gap-2 rounded-md border border-ai-border bg-ai-bg px-3 py-2 text-ai-text">
                <span>
                  <strong>{po.po_id}</strong> not acknowledged — follow-up drafted{po.followup_escalate ? ' (escalate)' : ''}
                </span>
                <Link className="font-medium hover:underline" to={`/purchase-orders/${po.po_id}`}>
                  Review →
                </Link>
              </li>
            ))}
            {data.tasks > 0 && (
              <li className="rounded-md border border-slate-200 px-3 py-2 text-slate-600">{data.tasks} put-away task(s) open for the Stock Associate.</li>
            )}
            {awaiting.length + draftPOs.length + openClaims.length + followups.length === 0 && <Empty>Nothing needs you right now.</Empty>}
          </ul>
        </Card>
      </div>

      <Card title="AI activity feed" actions={<Link className="text-sm text-navy hover:underline" to="/agent-log">Full log →</Link>}>
        {data.log.length === 0 ? (
          <Empty>No agent activity yet.</Empty>
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.log.map((l) => (
              <li key={l.log_id} className="flex flex-wrap items-start gap-3 py-2.5 text-sm">
                <Chip tone={l.agent_name === 'System Rules' ? 'navy' : 'purple'}>{l.agent_name}</Chip>
                <div className="min-w-0 flex-1">
                  <div className="font-medium">
                    {l.action_type.replace(/_/g, ' ')} · {l.entity_id}
                  </div>
                  <div className="text-slate-600">{l.output_summary}</div>
                </div>
                <StatusChip status={l.human_decision} />
                <span className="text-xs text-slate-400">{l.created_at.replace('T', ' ')}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal open={!!insight} onClose={() => setInsight(null)} title="Weekly inventory summary" wide>
        {insight && (
          <div className="space-y-4">
            {insight.error && <div className="rounded-md bg-red-50 p-2 text-sm text-red-700">Agent error: {insight.error}. Showing rule-based summary.</div>}
            <AIPanel title="Inventory Insights agent" source={insight.source}>
              <p>{insight.summary}</p>
              {insight.action_items.length > 0 && (
                <>
                  <div className="mt-3 font-semibold">Action items</div>
                  <ol className="ml-5 list-decimal space-y-1">
                    {insight.action_items.map((a, i) => (
                      <li key={i}>{a}</li>
                    ))}
                  </ol>
                </>
              )}
              {insight.anomalies.length > 0 && (
                <>
                  <div className="mt-3 font-semibold">Anomalies</div>
                  <ul className="ml-5 list-disc">
                    {insight.anomalies.map((a, i) => (
                      <li key={i}>
                        {a.product_id ? `${product(a.product_id)?.name ?? a.product_id}: ` : ''}
                        {a.description}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </AIPanel>
            <div className="flex justify-end">
              <Button
                variant="secondary"
                onClick={async () => {
                  await decideLog(insight.entity_id, 'No_Action', user, 'Inventory Insights');
                  setInsight(null);
                }}
              >
                Mark as reviewed
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
