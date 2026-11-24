// Orchestration: UI → (deterministic domain rules + AI drafts) → Dexie.
// Agents only draft; every decision here is made by rules or by a human user.
import { db, nextId } from '../db/schema';
import { BASE_DEMAND } from '../db/seed';
import { agents, type AgentResult } from '../agents/client';
import { mockProcurement } from '../agents/mocks';
import { checkReorderPoints } from '../domain/reorder';
import { prTotal, routeForApproval } from '../domain/approval';
import { selectVendorAndCreatePO, type VendorScore } from '../domain/vendors';
import { performThreeWayMatch } from '../domain/match';
import { assignBinLocation } from '../domain/putaway';
import type {
  AgentActionLog,
  AgentName,
  ASN,
  Discrepancy,
  DiscrepancyType,
  HumanDecision,
  Inventory,
  PRLine,
  Product,
  PurchaseOrder,
  PurchaseRequisition,
  ReceiptLine,
  Resolution,
  SettingsMap,
  ShipMode,
  User,
} from '../domain/types';
import { addDays, availableFor, daysBetween, daysOfCover, onHandFor, onOrderFor, round2, roundUpToCasePack } from '../domain/util';
import { simulatedDailySales, thanksgiving } from '../sim/sales';
import { notify } from './events';

export const SHIP_TO = 'StockPilot Store #12, 1200 Main St, Dallas, TX 75201';

// ───────────────────────── helpers ─────────────────────────

export async function getSettings(): Promise<SettingsMap> {
  const rows = await db.settings.toArray();
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    auto_approve_limit: Number(m.auto_approve_limit ?? 1000),
    ack_timeout_hours: Number(m.ack_timeout_hours ?? 48),
    match_tolerance_pct: Number(m.match_tolerance_pct ?? 2),
  };
}

export async function getSimDate(): Promise<string> {
  return (await db.settings.get('sim_date'))?.value ?? '2026-11-16';
}

const nowStamp = async () => `${await getSimDate()}T${new Date().toISOString().slice(11, 19)}`;

/** Average daily units sold over the `days` days before `endDate` (exclusive). */
export async function avgDailySalesMap(endDate: string, days = 28): Promise<Record<string, number>> {
  const start = addDays(endDate, -days);
  const rows = await db.sales.where('sale_datetime').between(`${start}T00:00:00`, `${endDate}T00:00:00`).toArray();
  const sums: Record<string, number> = {};
  for (const r of rows) sums[r.product_id] = (sums[r.product_id] ?? 0) + r.qty_sold;
  return Object.fromEntries(Object.entries(sums).map(([k, v]) => [k, v / days]));
}

async function salesSeries(productId: string, endDate: string, days: number): Promise<number[]> {
  const out: number[] = [];
  for (let d = days; d >= 1; d--) {
    const date = addDays(endDate, -d);
    const r = await db.sales.where('sale_datetime').equals(`${date}T20:00:00`).filter((s) => s.product_id === productId).toArray();
    out.push(r.reduce((s, x) => s + x.qty_sold, 0));
  }
  return out;
}

async function primaryInventory(productId: string): Promise<Inventory | undefined> {
  return (await db.inventory.get(`INV-${productId}`)) ?? (await db.inventory.where('product_id').equals(productId).first());
}

async function adjustOnOrder(productId: string, delta: number) {
  const row = await primaryInventory(productId);
  if (row) await db.inventory.update(row.inventory_id, { qty_on_order: Math.max(0, row.qty_on_order + delta) });
}

function surfaceAgentResult(agent: AgentName, r: AgentResult<unknown>) {
  if (r.source === 'fallback') {
    notify({
      kind: 'error',
      title: `${agent} agent returned an invalid response`,
      body: `${r.error ?? 'Unknown error'}. Fell back to the rule-based result.`,
    });
  }
}

export async function logAgent(entry: Omit<AgentActionLog, 'log_id' | 'created_at' | 'decided_by'> & { decided_by?: string | null }): Promise<string> {
  const log_id = await nextId('LOG');
  await db.agent_action_log.add({ ...entry, decided_by: entry.decided_by ?? null, log_id, created_at: await nowStamp() });
  return log_id;
}

/** Record the human decision on the pending log row(s) for an entity — once. */
export async function decideLog(entityId: string, decision: HumanDecision, user: User | null, agentName?: AgentName) {
  const rows = await db.agent_action_log
    .where('entity_id')
    .equals(entityId)
    .filter((r) => r.human_decision === 'Pending' && (!agentName || r.agent_name === agentName))
    .toArray();
  for (const r of rows) await db.agent_action_log.update(r.log_id, { human_decision: decision, decided_by: user?.user_id ?? 'SYSTEM' });
}

function sourceTag(r: AgentResult<unknown>) {
  return r.source === 'fallback' ? ' [rule-based fallback]' : r.source === 'mock' ? ' [mock]' : '';
}

// ───────────────────────── POS simulator ─────────────────────────

export async function runPosDay(): Promise<{ date: string; units: number; newPRs: string[] }> {
  const date = await getSimDate();
  const products = await db.products.toArray();
  let units = 0;
  for (const p of products) {
    const demand = simulatedDailySales(p.sku, p.category, BASE_DEMAND[p.sku] ?? 1, date);
    const rows = (await db.inventory.where('product_id').equals(p.product_id).toArray()).filter((r) => !r.bin_id.startsWith('QUA'));
    let remaining = Math.min(demand, rows.reduce((s, r) => s + r.qty_on_hand, 0));
    const sold = remaining;
    for (const r of rows.sort((a, b) => a.qty_on_hand - b.qty_on_hand)) {
      if (remaining <= 0) break;
      const take = Math.min(r.qty_on_hand, remaining);
      await db.inventory.update(r.inventory_id, { qty_on_hand: r.qty_on_hand - take });
      remaining -= take;
    }
    if (sold > 0) {
      await db.sales.put({ pos_txn_id: `POS-${date.replace(/-/g, '')}-${p.sku}`, product_id: p.product_id, qty_sold: sold, sale_datetime: `${date}T20:00:00` });
      units += sold;
    }
  }
  const next = addDays(date, 1);
  await db.settings.put({ key: 'sim_date', value: next });
  const newPRs = await runReplenishmentCycle(next);
  await runExpeditingCheck(next);
  return { date, units, newPRs };
}

// ───────────────────────── Replenishment ─────────────────────────

export async function runReplenishmentCycle(runDate: string): Promise<string[]> {
  const [products, inventory, prs, prLines, vps] = await Promise.all([
    db.products.toArray(),
    db.inventory.toArray(),
    db.purchase_requisitions.toArray(),
    db.pr_lines.toArray(),
    db.vendor_products.toArray(),
  ]);
  const avg = await avgDailySalesMap(runDate);
  const openPRs = prs.map((pr) => ({ pr, lines: prLines.filter((l) => l.pr_id === pr.pr_id) }));
  const { candidates, reviewed } = checkReorderPoints(products, inventory, openPRs, runDate, avg);
  for (const p of reviewed) await db.products.update(p.product_id, { last_reviewed_at: p.last_reviewed_at });
  if (candidates.length === 0) return [];

  const tg = thanksgiving(new Date(runDate).getUTCFullYear()).toISOString().slice(0, 10);
  const daysToTg = daysBetween(runDate, tg);
  const events = daysToTg >= 0 && daysToTg <= 21 ? [{ name: 'Thanksgiving', date: tg }] : [];

  // One PR per category.
  const groups = new Map<string, typeof candidates>();
  for (const c of candidates) groups.set(c.product.category, [...(groups.get(c.product.category) ?? []), c]);

  const created: string[] = [];
  for (const [category, items] of groups) {
    const input = {
      run_date: runDate,
      upcoming_events: events,
      items: await Promise.all(
        items.map(async (c) => {
          const p = c.product;
          const leads = vps.filter((v) => v.product_id === p.product_id).map((v) => v.lead_time_days);
          return {
            product_id: p.product_id,
            sku: p.sku,
            name: p.name,
            category: p.category,
            trigger: c.trigger,
            on_hand: onHandFor(p.product_id, inventory),
            on_order: onOrderFor(p.product_id, inventory),
            available: c.available,
            reorder_point: p.reorder_point,
            safety_stock: p.safety_stock,
            max_stock: p.max_stock,
            case_pack: p.case_pack,
            unit_cost: p.unit_cost,
            review_cycle_days: p.review_cycle_days,
            avg_daily_sales_28d: round2(avg[p.product_id] ?? 0),
            last_7_days_sales: await salesSeries(p.product_id, runDate, 7),
            days_of_cover: Number.isFinite(c.days_of_cover) ? round2(c.days_of_cover) : null,
            best_lead_time_days: leads.length ? Math.min(...leads) : 3,
            rule_based_qty: roundUpToCasePack(Math.max(0, p.max_stock - c.available), p.case_pack),
          };
        }),
      ),
    };

    const result = await agents.replenishment(input);
    surfaceAgentResult('Replenishment Planner', result);

    // Keep only lines for products we asked about; enforce case-pack rounding.
    const allowed = new Map(input.items.map((i) => [i.product_id, i]));
    const agentLines = result.data.lines.filter((l) => allowed.has(l.product_id) && l.recommended_qty > 0);
    if (agentLines.length === 0) continue;

    const pr_id = await nextId('PR');
    const lines: PRLine[] = [];
    for (const l of agentLines) {
      const item = allowed.get(l.product_id)!;
      lines.push({
        pr_line_id: await nextId('PRL'),
        pr_id,
        product_id: l.product_id,
        requested_qty: roundUpToCasePack(l.recommended_qty, item.case_pack),
        est_unit_cost: item.unit_cost,
        confidence: l.confidence,
        rationale: `${l.rationale} (forecast ${Math.round(l.forecast_qty)} units${l.needs_review ? '; agent flagged for review' : ''})`,
      });
    }
    const source = items.some((i) => i.trigger === 'Below_ROP') ? 'Below_ROP' : 'Periodic_Review';
    const pr: PurchaseRequisition = {
      pr_id,
      source,
      status: 'Draft',
      est_total_cost: prTotal(lines),
      ai_rationale: result.data.summary,
      ai_generated: true,
      created_by: null,
      approved_by: null,
      created_at: await nowStamp(),
      approved_at: null,
      manager_comments: '',
    };
    await db.purchase_requisitions.add(pr);
    await db.pr_lines.bulkAdd(lines);
    await logAgent({
      agent_name: 'Replenishment Planner',
      action_type: 'Draft_PR',
      entity_type: 'purchase_requisition',
      entity_id: pr_id,
      output_summary: `${category}: ${lines.length} line(s), est. $${pr.est_total_cost.toFixed(2)}${sourceTag(result)}`,
      human_decision: 'Pending',
    });
    await routePR(pr_id);
    created.push(pr_id);
  }
  return created;
}

/** Apply deterministic approval routing to a Draft PR. */
export async function routePR(prId: string) {
  const pr = (await db.purchase_requisitions.get(prId))!;
  const lines = await db.pr_lines.where('pr_id').equals(prId).toArray();
  const [users, settings, products, inventory] = await Promise.all([db.users.toArray(), getSettings(), db.products.toArray(), db.inventory.toArray()]);
  const available = Object.fromEntries(products.map((p) => [p.product_id, availableFor(p.product_id, inventory)]));
  const r = routeForApproval(pr, lines, users, settings, { products, available });

  if (r.route === 'Auto_Approved') {
    await db.purchase_requisitions.update(prId, {
      status: 'Approved',
      approved_by: 'SYSTEM',
      approved_at: await nowStamp(),
      est_total_cost: r.total,
      assigned_approver: 'SYSTEM',
    });
    await decideLog(prId, 'Auto_Approved', null, 'Replenishment Planner');
    await logAgent({
      agent_name: 'System Rules',
      action_type: 'Auto_Approve_PR',
      entity_type: 'purchase_requisition',
      entity_id: prId,
      output_summary: `Auto-approved: $${r.total.toFixed(2)} ≤ limit $${settings.auto_approve_limit.toFixed(2)}, no flags`,
      human_decision: 'Auto_Approved',
    });
    await createPOsForPR(prId, { autoSend: true });
  } else {
    await db.purchase_requisitions.update(prId, {
      status: r.route === 'Escalated' ? 'Escalated' : 'Pending_Approval',
      est_total_cost: r.total,
      assigned_approver: r.approver_id,
      manager_comments: r.flagged.length ? `Flags: ${r.flagged.map((f) => f.reason).join('; ')}` : pr.manager_comments,
    });
    await logAgent({
      agent_name: 'System Rules',
      action_type: r.route === 'Escalated' ? 'Escalate_PR' : 'Route_PR',
      entity_type: 'purchase_requisition',
      entity_id: prId,
      output_summary: `${r.route.replace('_', ' ')} → ${r.approver_id ?? 'none'}: ${r.reason}`,
      human_decision: 'No_Action',
    });
  }
}

export async function savePREdits(prId: string, qtys: Record<string, number>) {
  for (const [lineId, qty] of Object.entries(qtys)) await db.pr_lines.update(lineId, { requested_qty: Math.max(0, Math.round(qty)) });
  const lines = await db.pr_lines.where('pr_id').equals(prId).toArray();
  await db.purchase_requisitions.update(prId, { est_total_cost: prTotal(lines) });
}

export function canApprovePR(pr: PurchaseRequisition, user: User): string | null {
  if (!['Pending_Approval', 'Escalated'].includes(pr.status)) return `PR is ${pr.status.replace('_', ' ')}`;
  if (!['Store_Manager', 'Regional_Manager'].includes(user.role)) return 'Only managers can approve requisitions';
  if (pr.created_by && pr.created_by === user.user_id) return 'Segregation of duties: you cannot approve a requisition you created';
  if (pr.status === 'Escalated' && user.role !== 'Regional_Manager') return 'Escalated — requires the Regional Manager';
  if (pr.est_total_cost > user.approval_limit) return `Total exceeds your approval limit of $${user.approval_limit.toFixed(2)}`;
  return null;
}

export async function approvePR(prId: string, user: User, qtys: Record<string, number>, comment = '') {
  const before = await db.pr_lines.where('pr_id').equals(prId).toArray();
  const edited = before.some((l) => qtys[l.pr_line_id] !== undefined && Math.round(qtys[l.pr_line_id]) !== l.requested_qty);
  await savePREdits(prId, qtys);
  const pr = (await db.purchase_requisitions.get(prId))!;
  const block = canApprovePR(pr, user);
  if (block) throw new Error(block);
  await db.purchase_requisitions.update(prId, {
    status: 'Approved',
    approved_by: user.user_id,
    approved_at: await nowStamp(),
    manager_comments: comment || pr.manager_comments,
  });
  await decideLog(prId, edited ? 'Approved_With_Edits' : 'Approved', user, 'Replenishment Planner');
  await createPOsForPR(prId, { autoSend: false });
}

export async function rejectPR(prId: string, user: User, comment: string) {
  if (!comment.trim()) throw new Error('A comment is required to reject a requisition');
  const pr = (await db.purchase_requisitions.get(prId))!;
  if (pr.created_by === user.user_id) throw new Error('Segregation of duties: you cannot decide on a requisition you created');
  await db.purchase_requisitions.update(prId, { status: 'Rejected', approved_by: user.user_id, approved_at: await nowStamp(), manager_comments: comment });
  await decideLog(prId, 'Rejected', user, 'Replenishment Planner');
}

export async function createManualPR(user: User, items: { product_id: string; qty: number }[], note: string) {
  const products = await db.products.toArray();
  const pr_id = await nextId('PR');
  const lines: PRLine[] = [];
  for (const it of items) {
    const p = products.find((x) => x.product_id === it.product_id)!;
    lines.push({
      pr_line_id: await nextId('PRL'),
      pr_id,
      product_id: it.product_id,
      requested_qty: roundUpToCasePack(it.qty, p.case_pack),
      est_unit_cost: p.unit_cost,
      confidence: 'High',
      rationale: 'Manual request',
    });
  }
  await db.purchase_requisitions.add({
    pr_id,
    source: 'Manual',
    status: 'Draft',
    est_total_cost: prTotal(lines),
    ai_rationale: '',
    ai_generated: false,
    created_by: user.user_id,
    approved_by: null,
    created_at: await nowStamp(),
    approved_at: null,
    manager_comments: note,
  });
  await db.pr_lines.bulkAdd(lines);
  await routePR(pr_id);
  return pr_id;
}

// ───────────────────────── Procurement ─────────────────────────

async function buildProcurementInput(prId: string, poIds: string[] | null, instruction?: string) {
  const lines = await db.pr_lines.where('pr_id').equals(prId).toArray();
  const [vps, vendors, products, inventory] = await Promise.all([db.vendor_products.toArray(), db.vendors.toArray(), db.products.toArray(), db.inventory.toArray()]);
  const avg = await avgDailySalesMap(await getSimDate());
  const cover: Record<string, number> = {};
  for (const l of lines) cover[l.product_id] = daysOfCover(availableFor(l.product_id, inventory), avg[l.product_id] ?? 0);
  const pr = (await db.purchase_requisitions.get(prId))!;
  const selection = selectVendorAndCreatePO(pr, lines, vps, vendors, products, cover);
  return { lines, vendors, products, cover, selection, instruction, poIds };
}

export async function createPOsForPR(prId: string, opts: { autoSend: boolean }) {
  const { vendors, products, cover, selection } = await buildProcurementInput(prId, null);
  const today = await getSimDate();
  const name = (id: string) => products.find((p) => p.product_id === id)?.name ?? id;

  const drafts = [];
  for (const po of selection.pos) {
    const v = vendors.find((x) => x.vendor_id === po.vendor_id)!;
    drafts.push({
      po_id: await nextId('PO'),
      vendor_id: po.vendor_id,
      vendor_name: v.name,
      vendor_email: v.email,
      expected_delivery_date: addDays(today, po.lead_time_days),
      total: po.total,
      lines: po.lines.map((l) => ({ product_id: l.product_id, name: name(l.product_id), qty: l.qty, unit_price: l.unit_price })),
    });
  }

  const input = {
    pr_id: prId,
    ship_to: SHIP_TO,
    lines: selection.lineScores.map((ls) => ({
      product_id: ls.product_id,
      name: name(ls.product_id),
      requested_qty: 0,
      days_of_cover: Number.isFinite(cover[ls.product_id]) ? round2(cover[ls.product_id]) : null,
      scores: ls.scores,
      chosen_vendor_id: ls.chosen,
    })),
    po_drafts: drafts,
  };
  const result = await agents.procurement(input);
  surfaceAgentResult('Procurement', result);

  const settings = await getSettings();
  for (const d of drafts) {
    const agentPO = result.data.pos.find((p) => p.vendor_id === d.vendor_id);
    // Rules decide: the agent's vendor/qty/price must match the in-house result exactly.
    const matches =
      !!agentPO &&
      agentPO.lines.length === d.lines.length &&
      d.lines.every((l) => agentPO.lines.some((a) => a.product_id === l.product_id && a.qty === l.qty && Math.abs(a.unit_price - l.unit_price) < 0.005));
    const fallback = mockProcurement({ ...input, po_drafts: [d] }).pos[0];
    const use = matches ? agentPO! : fallback;
    if (agentPO && !matches) {
      notify({ kind: 'warning', title: `Procurement agent changed lines on ${d.po_id}`, body: 'Ignored — in-house vendor scoring and quantities were kept.' });
    }
    const snapshot = selection.lineScores.filter((ls) => d.lines.some((l) => l.product_id === ls.product_id));
    const po: PurchaseOrder = {
      po_id: d.po_id,
      pr_id: prId,
      vendor_id: d.vendor_id,
      status: 'Draft',
      order_date: today,
      expected_delivery_date: d.expected_delivery_date,
      total_amount: d.total,
      tracking_number: '',
      ai_generated: true,
      approved_by: null,
      order_email: use.order_email,
      selection_note: use.selection_note,
      score_snapshot: JSON.stringify(snapshot),
    };
    await db.purchase_orders.add(po);
    for (const l of d.lines) {
      await db.po_lines.add({ po_line_id: await nextId('POL'), po_id: d.po_id, product_id: l.product_id, ordered_qty: l.qty, unit_price: l.unit_price, received_qty: 0 });
    }
    await logAgent({
      agent_name: 'Procurement',
      action_type: 'Draft_PO',
      entity_type: 'purchase_order',
      entity_id: d.po_id,
      output_summary: `${d.vendor_name}: ${d.lines.length} line(s), $${d.total.toFixed(2)}. ${use.selection_note}${sourceTag(result)}`.slice(0, 400),
      human_decision: 'Pending',
    });
    if (opts.autoSend && d.total <= settings.auto_approve_limit) {
      await sendPO(d.po_id, null);
    }
  }
  await db.purchase_requisitions.update(prId, { status: 'Converted' });
}

export async function revisePO(poId: string, instruction: string) {
  const po = (await db.purchase_orders.get(poId))!;
  const { vendors, products, cover, selection } = await buildProcurementInput(po.pr_id, [poId]);
  const v = vendors.find((x) => x.vendor_id === po.vendor_id)!;
  const lines = await db.po_lines.where('po_id').equals(poId).toArray();
  const name = (id: string) => products.find((p) => p.product_id === id)?.name ?? id;
  const input = {
    pr_id: po.pr_id,
    ship_to: SHIP_TO,
    revision_instruction: instruction,
    lines: selection.lineScores
      .filter((ls) => lines.some((l) => l.product_id === ls.product_id))
      .map((ls) => ({
        product_id: ls.product_id,
        name: name(ls.product_id),
        requested_qty: 0,
        days_of_cover: Number.isFinite(cover[ls.product_id]) ? round2(cover[ls.product_id]) : null,
        scores: ls.scores,
        chosen_vendor_id: ls.chosen,
      })),
    po_drafts: [
      {
        po_id: poId,
        vendor_id: po.vendor_id,
        vendor_name: v.name,
        vendor_email: v.email,
        expected_delivery_date: po.expected_delivery_date,
        total: po.total_amount,
        lines: lines.map((l) => ({ product_id: l.product_id, name: name(l.product_id), qty: l.ordered_qty, unit_price: l.unit_price })),
      },
    ],
  };
  const result = await agents.procurement(input);
  surfaceAgentResult('Procurement', result);
  const out = result.data.pos.find((p) => p.vendor_id === po.vendor_id) ?? result.data.pos[0];
  if (out) await db.purchase_orders.update(poId, { order_email: out.order_email, selection_note: out.selection_note });
  await logAgent({
    agent_name: 'Procurement',
    action_type: 'Revise_PO_Email',
    entity_type: 'purchase_order',
    entity_id: poId,
    output_summary: `Revised wording: "${instruction}"${sourceTag(result)}`,
    human_decision: 'Pending',
  });
}

export function canSendPO(po: PurchaseOrder, user: User): string | null {
  if (po.status !== 'Draft') return `PO is ${po.status}`;
  if (!['Store_Manager', 'Regional_Manager'].includes(user.role)) return 'Only managers can approve purchase orders';
  if (po.total_amount > user.approval_limit) return `PO total exceeds your approval limit`;
  return null;
}

/** Approve & send a PO. user = null means sent by system rules (auto-approve). */
export async function sendPO(poId: string, user: User | null, emailOverride?: string) {
  const po = (await db.purchase_orders.get(poId))!;
  if (user) {
    const block = canSendPO(po, user);
    if (block) throw new Error(block);
  }
  const today = await getSimDate();
  const edited = emailOverride !== undefined && emailOverride !== po.order_email;
  await db.purchase_orders.update(poId, {
    status: 'Sent',
    approved_by: user?.user_id ?? 'SYSTEM',
    sent_at: today,
    order_date: today,
    order_email: emailOverride ?? po.order_email,
  });
  const lines = await db.po_lines.where('po_id').equals(poId).toArray();
  for (const l of lines) await adjustOnOrder(l.product_id, l.ordered_qty);
  await decideLog(poId, user ? (edited ? 'Approved_With_Edits' : 'Approved') : 'Auto_Approved', user, 'Procurement');
  if (!user) {
    await logAgent({
      agent_name: 'System Rules',
      action_type: 'Auto_Send_PO',
      entity_type: 'purchase_order',
      entity_id: poId,
      output_summary: `PO $${po.total_amount.toFixed(2)} sent automatically (PR auto-approved, within limit)`,
      human_decision: 'Auto_Approved',
    });
  }
}

export async function cancelPO(poId: string, user: User) {
  await db.purchase_orders.update(poId, { status: 'Cancelled', approved_by: user.user_id });
  await decideLog(poId, 'Rejected', user, 'Procurement');
}

// ───────────────────────── Vendor simulator & expediting ─────────────────────────

export async function runExpeditingCheck(today: string) {
  const settings = await getSettings();
  const pos = await db.purchase_orders.where('status').equals('Sent').toArray();
  const vendors = await db.vendors.toArray();
  for (const po of pos) {
    if (!po.sent_at || po.followup_email) continue;
    const hours = daysBetween(po.sent_at, today) * 24;
    if (hours < settings.ack_timeout_hours) continue;
    const v = vendors.find((x) => x.vendor_id === po.vendor_id)!;
    const result = await agents.expediting({
      mode: 'followup',
      po_id: po.po_id,
      vendor_name: v.name,
      order_date: po.order_date,
      expected_delivery_date: po.expected_delivery_date,
      hours_since_sent: hours,
      ack_timeout_hours: settings.ack_timeout_hours,
      today,
    });
    surfaceAgentResult('Vendor Expediting', result);
    await db.purchase_orders.update(po.po_id, { followup_email: result.data.followup_email ?? '', followup_escalate: result.data.escalate });
    await logAgent({
      agent_name: 'Vendor Expediting',
      action_type: 'Draft_Followup',
      entity_type: 'purchase_order',
      entity_id: po.po_id,
      output_summary: `No acknowledgement after ${hours} h${result.data.escalate ? ' — recommends escalation' : ''}${sourceTag(result)}`,
      human_decision: 'Pending',
    });
  }
}

export async function decideFollowup(poId: string, user: User, send: boolean) {
  await decideLog(poId, send ? 'Approved' : 'Rejected', user, 'Vendor Expediting');
  await db.purchase_orders.update(poId, { followup_email: send ? '(sent) ' : '(dismissed) ' });
}

export async function vendorAcknowledge(poId: string, note: string) {
  const po = (await db.purchase_orders.get(poId))!;
  const today = await getSimDate();
  await db.purchase_orders.update(poId, { status: 'Acknowledged', acknowledged_at: today, vendor_note: note });
  if (note.trim()) {
    const v = (await db.vendors.get(po.vendor_id))!;
    const settings = await getSettings();
    const result = await agents.expediting({
      mode: 'parse_note',
      po_id: poId,
      vendor_name: v.name,
      order_date: po.order_date,
      expected_delivery_date: po.expected_delivery_date,
      hours_since_sent: po.sent_at ? daysBetween(po.sent_at, today) * 24 : 0,
      ack_timeout_hours: settings.ack_timeout_hours,
      vendor_note: note,
      today,
    });
    surfaceAgentResult('Vendor Expediting', result);
    await logAgent({
      agent_name: 'Vendor Expediting',
      action_type: 'Parse_Vendor_Note',
      entity_type: 'purchase_order',
      entity_id: poId,
      output_summary: `${result.data.parsed_note_summary ?? ''}${result.data.revised_delivery_date ? ` (revised ETA ${result.data.revised_delivery_date})` : ''}${sourceTag(result)}`,
      human_decision: 'Pending',
    });
  }
}

export async function vendorShip(
  poId: string,
  mode: ShipMode,
  perLine: Record<string, { shipped: number; damaged: number; wrong: number }>,
  note: string,
) {
  const po = (await db.purchase_orders.get(poId))!;
  const lines = await db.po_lines.where('po_id').equals(poId).toArray();
  const today = await getSimDate();
  const asn: ASN = {
    shipped_at: today,
    mode,
    packing_slip_no: `PS-${poId.split('-')[1]}-${Math.floor(Math.random() * 900 + 100)}`,
    note,
    lines: lines.map((l) => ({
      po_line_id: l.po_line_id,
      product_id: l.product_id,
      qty_shipped: perLine[l.po_line_id]?.shipped ?? l.ordered_qty - l.received_qty,
      qty_damaged: perLine[l.po_line_id]?.damaged ?? 0,
      qty_wrong_item: perLine[l.po_line_id]?.wrong ?? 0,
      unit_price: l.unit_price,
    })),
  };
  if (mode === 'wrong_item') asn.note = (note ? note + ' ' : '') + 'Substituted item packed on one line.';
  await db.purchase_orders.update(poId, {
    status: po.status === 'Sent' ? 'Acknowledged' : po.status,
    acknowledged_at: po.acknowledged_at ?? today,
    tracking_number: `1Z${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
    asn,
  });
}

// ───────────────────────── Receiving ─────────────────────────

export interface ReceiveLineInput {
  po_line_id: string;
  qty_received: number;
  qty_damaged: number;
  qty_wrong_item: number;
  slip_unit_price?: number;
  condition_notes: string;
}

export async function submitReceipt(poId: string, clerk: User, packingSlip: string, inputs: ReceiveLineInput[]) {
  const po = (await db.purchase_orders.get(poId))!;
  if (po.approved_by === clerk.user_id) throw new Error('Segregation of duties: the PO approver cannot receive the same PO');
  if (!['Sent', 'Acknowledged', 'Partially_Received'].includes(po.status)) throw new Error(`PO ${poId} is ${po.status} and cannot be received`);
  const settings = await getSettings();
  const poLines = await db.po_lines.where('po_id').equals(poId).toArray();
  const receipt_id = await nextId('GR');
  const receipt = { receipt_id, po_id: poId, received_by: clerk.user_id, packing_slip_no: packingSlip, received_at: await nowStamp(), status: 'Pending_Inspection' as const };
  const rLines: ReceiptLine[] = [];
  for (const i of inputs) {
    rLines.push({
      receipt_line_id: await nextId('RL'),
      receipt_id,
      po_line_id: i.po_line_id,
      qty_received: i.qty_received,
      qty_accepted: 0,
      qty_damaged: i.qty_damaged,
      qty_wrong_item: i.qty_wrong_item,
      slip_unit_price: i.slip_unit_price,
      condition_notes: i.condition_notes,
    });
  }
  const match = performThreeWayMatch(receipt, rLines, poLines, po.asn, settings.match_tolerance_pct);

  await db.goods_receipts.add({ ...receipt, status: match.status });
  for (const rl of rLines) {
    const m = match.lines.find((x) => x.receipt_line_id === rl.receipt_line_id);
    rl.qty_accepted = m?.qty_accepted ?? 0;
    if (match.asnNotes.length) rl.condition_notes = [rl.condition_notes, ...match.asnNotes.filter((n) => n.includes(rl.po_line_id))].filter(Boolean).join(' | ');
  }
  await db.receipt_lines.bulkAdd(rLines);
  for (const u of match.poLineUpdates) await db.po_lines.update(u.po_line_id, { received_qty: u.received_qty });
  await db.purchase_orders.update(poId, { status: match.poStatus });

  // Discrepancies
  const products = await db.products.toArray();
  const discs: Discrepancy[] = [];
  for (const m of match.lines) {
    const pol = poLines.find((p) => p.po_line_id === m.po_line_id)!;
    for (const f of m.flags) {
      discs.push({
        discrepancy_id: await nextId('DSC'),
        receipt_line_id: m.receipt_line_id,
        receipt_id,
        po_id: poId,
        product_id: pol.product_id,
        unit_price: pol.unit_price,
        type: f.type,
        qty_variance: f.qty_variance,
        resolution: 'Pending',
        vendor_message: '',
        resolved_by: null,
        resolved_at: null,
        claim_status: 'Draft',
      });
    }
  }
  if (discs.length) await db.discrepancies.bulkAdd(discs);

  // Put-away tasks for accepted qty
  const associate = (await db.users.where('role').equals('Stock_Associate').first())!;
  const bins = await db.bin_locations.toArray();
  for (const m of match.lines) {
    if (m.qty_accepted <= 0) continue;
    const pol = poLines.find((p) => p.po_line_id === m.po_line_id)!;
    const product = products.find((p) => p.product_id === pol.product_id)!;
    const plan = assignBinLocation(product, m.qty_accepted, bins, await db.inventory.toArray(), await db.putaway_tasks.toArray());
    for (const a of plan.assignments) {
      await db.putaway_tasks.add({
        task_id: await nextId('PA'),
        receipt_line_id: m.receipt_line_id,
        product_id: product.product_id,
        bin_id: a.bin_id,
        assigned_to: associate.user_id,
        qty: a.qty,
        status: 'Open',
        completed_at: null,
      });
    }
    if (plan.notify_manager) {
      await logAgent({
        agent_name: 'System Rules',
        action_type: 'Overflow_Notice',
        entity_type: 'putaway_task',
        entity_id: m.receipt_line_id,
        output_summary: `${plan.overflow_qty} units of ${product.name} assigned to Overflow — no compatible bin capacity`,
        human_decision: 'No_Action',
      });
      notify({ kind: 'warning', title: 'Overflow bin used', body: `${plan.overflow_qty} units of ${product.name} go to Overflow. Manager notified.` });
    }
  }

  if (discs.length) await draftClaim(receipt_id);
  return { receipt_id, status: match.status, discrepancies: discs.length, asnNotes: match.asnNotes };
}

export async function draftClaim(receiptId: string, instruction?: string) {
  const receipt = (await db.goods_receipts.get(receiptId))!;
  const po = (await db.purchase_orders.get(receipt.po_id))!;
  const v = (await db.vendors.get(po.vendor_id))!;
  const discs = await db.discrepancies.where('receipt_id').equals(receiptId).toArray();
  const products = await db.products.toArray();
  const input = {
    po_id: po.po_id,
    receipt_id: receiptId,
    packing_slip_no: receipt.packing_slip_no,
    vendor: { name: v.name, email: v.email },
    discrepancies: discs.map((d) => {
      const p = products.find((x) => x.product_id === d.product_id);
      return {
        discrepancy_id: d.discrepancy_id,
        product_id: d.product_id ?? '',
        product_name: p?.name ?? '',
        category: p?.category ?? '',
        type: d.type,
        qty_variance: d.qty_variance,
        unit_price: d.unit_price ?? 0,
        line_value: round2(d.qty_variance * (d.unit_price ?? 0)),
      };
    }),
    asn_notes: po.asn?.note ? [po.asn.note] : [],
    instruction,
  };
  const result = await agents.discrepancy(input);
  surfaceAgentResult('Receiving Discrepancy', result);
  const expected = round2(input.discrepancies.filter((d) => ['Short', 'Damaged', 'Wrong_Item'].includes(d.type)).reduce((s, d) => s + d.line_value, 0));
  if (Math.abs(result.data.claimed_amount - expected) > 0.01) {
    notify({ kind: 'warning', title: 'Claim amount differs from rule check', body: `Agent claimed $${result.data.claimed_amount.toFixed(2)}; rules compute $${expected.toFixed(2)}. Review before sending.` });
  }
  // Suggested (not decided) resolutions live in the agent log; the manager decides.
  for (const d of discs) {
    await db.discrepancies.update(d.discrepancy_id, {
      vendor_message: result.data.email_text,
      claim_subject: result.data.subject,
      claimed_amount: result.data.claimed_amount,
    });
  }
  await logAgent({
    agent_name: 'Receiving Discrepancy',
    action_type: instruction ? 'Regenerate_Claim' : 'Draft_Claim',
    entity_type: 'goods_receipt',
    entity_id: receiptId,
    output_summary: `${result.data.subject}. Suggested: ${result.data.suggested_resolutions.map((s) => `${s.discrepancy_id}→${s.resolution}`).join(', ')}${sourceTag(result)}`.slice(0, 400),
    human_decision: 'Pending',
  });
  return result.data;
}

export async function getSuggestedResolutions(receiptId: string): Promise<Record<string, Resolution>> {
  const logs = (await db.agent_action_log.where('entity_id').equals(receiptId).toArray())
    .filter((l) => l.agent_name === 'Receiving Discrepancy')
    .sort((a, b) => b.log_id.localeCompare(a.log_id));
  const text = logs[0]?.output_summary ?? '';
  const out: Record<string, Resolution> = {};
  for (const m of text.matchAll(/(DSC-\d+)→(\w+)/g)) out[m[1]] = m[2] as Resolution;
  return out;
}

export async function approveClaim(receiptId: string, user: User, emailText: string, resolutions: Record<string, Resolution>) {
  if (user.role !== 'Store_Manager' && user.role !== 'Regional_Manager') throw new Error('Only managers can send vendor claims');
  const discs = await db.discrepancies.where('receipt_id').equals(receiptId).toArray();
  const edited = discs.some((d) => d.vendor_message !== emailText);
  const now = await nowStamp();
  for (const d of discs) {
    const res = resolutions[d.discrepancy_id] ?? 'Credit_Requested';
    await db.discrepancies.update(d.discrepancy_id, { resolution: res, vendor_message: emailText, claim_status: 'Sent', resolved_by: user.user_id, resolved_at: now });
    // Units we will not receive no longer count as on order.
    const notComing: DiscrepancyType[] = ['Short', 'Damaged', 'Wrong_Item'];
    if (d.product_id && notComing.includes(d.type) && res !== 'Replacement_Requested') await adjustOnOrder(d.product_id, -d.qty_variance);
  }
  await decideLog(receiptId, edited ? 'Approved_With_Edits' : 'Approved', user, 'Receiving Discrepancy');
}

// ───────────────────────── Put-away ─────────────────────────

export async function confirmPutaway(taskId: string, scannedBin: string, qty: number, user: User): Promise<{ ok: boolean; message: string }> {
  const task = (await db.putaway_tasks.get(taskId))!;
  if (task.status !== 'Open') return { ok: false, message: 'Task already completed' };
  if (scannedBin.trim().toUpperCase() !== task.bin_id.toUpperCase()) {
    return { ok: false, message: `Wrong bin: you scanned ${scannedBin.toUpperCase() || '(nothing)'}, task requires ${task.bin_id}. Inventory not updated.` };
  }
  if (qty <= 0 || qty > task.qty) return { ok: false, message: `Quantity must be between 1 and ${task.qty}` };

  const existing = await db.inventory.where('[product_id+bin_id]').equals([task.product_id, task.bin_id]).first();
  if (existing) await db.inventory.update(existing.inventory_id, { qty_on_hand: existing.qty_on_hand + qty, last_counted_at: await getSimDate() });
  else
    await db.inventory.add({
      inventory_id: await nextId('INV'),
      product_id: task.product_id,
      bin_id: task.bin_id,
      qty_on_hand: qty,
      qty_on_order: 0,
      last_counted_at: await getSimDate(),
    });
  await adjustOnOrder(task.product_id, -qty);
  const now = await nowStamp();
  await db.putaway_tasks.update(taskId, { status: 'Completed', completed_at: now, qty, assigned_to: user.user_id });
  if (qty < task.qty) {
    await db.putaway_tasks.add({ ...task, task_id: await nextId('PA'), qty: task.qty - qty, status: 'Open', completed_at: null });
  }
  return { ok: true, message: `Stored ${qty} units in ${task.bin_id}. Inventory updated.` };
}

// ───────────────────────── Inventory settings ─────────────────────────

export async function updateReorderSettings(user: User, productId: string, fields: Pick<Product, 'reorder_point' | 'safety_stock' | 'max_stock' | 'review_cycle_days'>) {
  if (user.role !== 'Store_Manager') throw new Error('Only the Store Manager can edit reorder settings');
  await db.products.update(productId, fields);
}

export async function updateSystemSettings(user: User, values: Partial<SettingsMap>) {
  if (user.role !== 'Store_Manager' && user.role !== 'Regional_Manager') throw new Error('Only managers can change settings');
  for (const [k, v] of Object.entries(values)) await db.settings.put({ key: k, value: String(v) });
}

// ───────────────────────── Insights ─────────────────────────

export async function weeklyInsights() {
  const today = await getSimDate();
  const [products, inventory, pos, vendors, discs] = await Promise.all([
    db.products.toArray(),
    db.inventory.toArray(),
    db.purchase_orders.toArray(),
    db.vendors.toArray(),
    db.discrepancies.toArray(),
  ]);
  const avg = await avgDailySalesMap(today);
  const last7 = await avgDailySalesMap(today, 7);
  const salesRows = await db.sales.where('sale_datetime').between(`${addDays(today, -14)}T00:00:00`, `${today}T00:00:00`).toArray();
  const cut = `${addDays(today, -7)}T00:00:00`;
  const cats = [...new Set(products.map((p) => p.category))];
  const units7 = products.map((p) => ({ product_id: p.product_id, name: p.name, units_7d: Math.round((last7[p.product_id] ?? 0) * 7) }));
  const lowStock = products
    .map((p) => {
      const a = availableFor(p.product_id, inventory);
      const c = daysOfCover(a, avg[p.product_id] ?? 0);
      return { product_id: p.product_id, name: p.name, available: a, reorder_point: p.reorder_point, days_of_cover: Number.isFinite(c) ? round2(c) : null };
    })
    .filter((x) => x.available <= x.reorder_point * 1.2);
  const openPOs = pos.filter((p) => ['Sent', 'Acknowledged', 'Partially_Received', 'Draft'].includes(p.status));
  const input = {
    week_ending: today,
    kpis: {
      items_below_rop: lowStock.filter((x) => x.available <= x.reorder_point).length,
      pos_in_transit: pos.filter((p) => ['Sent', 'Acknowledged', 'Partially_Received'].includes(p.status)).length,
      open_discrepancies: discs.filter((d) => d.resolution === 'Pending').length,
      prs_awaiting_approval: (await db.purchase_requisitions.where('status').anyOf('Pending_Approval', 'Escalated').count()),
    },
    low_stock: lowStock,
    open_pos: openPOs.map((p) => ({ po_id: p.po_id, vendor: vendors.find((v) => v.vendor_id === p.vendor_id)?.name ?? '', status: p.status, expected: p.expected_delivery_date, total: p.total_amount })),
    open_discrepancies: discs
      .filter((d) => d.resolution === 'Pending')
      .map((d) => ({ discrepancy_id: d.discrepancy_id, type: d.type, product: products.find((p) => p.product_id === d.product_id)?.name ?? '', qty: d.qty_variance })),
    top_sellers: [...units7].sort((a, b) => b.units_7d - a.units_7d).slice(0, 5),
    slow_movers: [...units7].sort((a, b) => a.units_7d - b.units_7d).slice(0, 3),
    category_sales: cats.map((c) => {
      const ids = new Set(products.filter((p) => p.category === c).map((p) => p.product_id));
      const rows = salesRows.filter((s) => ids.has(s.product_id));
      return {
        category: c,
        last_7: rows.filter((s) => s.sale_datetime >= cut).reduce((t, s) => t + s.qty_sold, 0),
        prior_7: rows.filter((s) => s.sale_datetime < cut).reduce((t, s) => t + s.qty_sold, 0),
      };
    }),
  };
  const result = await agents.insights(input);
  surfaceAgentResult('Inventory Insights', result);
  const log_id = await logAgent({
    agent_name: 'Inventory Insights',
    action_type: 'Weekly_Summary',
    entity_type: 'store',
    entity_id: `WEEK-${today}`,
    output_summary: result.data.summary.slice(0, 400) + sourceTag(result),
    human_decision: 'Pending',
  });
  return { ...result, log_id, entity_id: `WEEK-${today}` };
}

export type { VendorScore };
