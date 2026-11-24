// End-to-end run of the Section 8 demo script in mock mode against an in-memory IndexedDB.
import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../db/schema';
import { resetDemoData } from '../db/seed';
import { availableFor } from '../domain/util';
import * as wf from './workflow';

const user = (id: string) => db.users.get(id).then((u) => u!);

describe('demo script (mock mode)', () => {
  beforeAll(async () => {
    await resetDemoData();
  });

  it('runs end to end', { timeout: 60000 }, async () => {
    const manager = await user('U001');
    const clerk = await user('U002');
    const associate = await user('U003');

    // 1. Calm start: nothing below ROP.
    const products = await db.products.toArray();
    let inv = await db.inventory.toArray();
    expect(products.filter((p) => availableFor(p.product_id, inv) <= p.reorder_point)).toHaveLength(0);

    // Run POS day twice → 5 items trigger, 2 PRs.
    const d1 = await wf.runPosDay();
    expect(d1.newPRs).toHaveLength(0);
    const d2 = await wf.runPosDay();
    expect(d2.newPRs).toHaveLength(2);

    // 2. Paper PR auto-approved (+ PO auto-sent); dairy PR pending.
    const prs = await db.purchase_requisitions.toArray();
    const paper = prs.find((p) => p.status === 'Converted')!;
    const dairy = prs.find((p) => p.status === 'Pending_Approval')!;
    expect(paper.approved_by).toBe('SYSTEM');
    expect(paper.est_total_cost).toBeLessThanOrEqual(1000);
    expect(dairy.est_total_cost).toBeGreaterThan(3000);
    expect(dairy.est_total_cost).toBeLessThan(10000);
    const dairyLines = await db.pr_lines.where('pr_id').equals(dairy.pr_id).toArray();
    expect(dairyLines).toHaveLength(3);

    // Edit one qty, approve.
    await wf.approvePR(dairy.pr_id, manager, { [dairyLines[0].pr_line_id]: dairyLines[0].requested_qty - 12 });
    const dairyPOs = await db.purchase_orders.where('pr_id').equals(dairy.pr_id).toArray();
    expect(dairyPOs).toHaveLength(1);
    const po = dairyPOs[0];
    expect((await db.vendors.get(po.vendor_id))!.name).toBe('Lone Star Dairy Co.');
    const snap = JSON.parse(po.score_snapshot!);
    expect(snap[0].scores.find((s: { vendor_name: string }) => s.vendor_name === 'FreshFarm Dairy').stockout_risk).toBe(true);

    // 3. Approve & send.
    await wf.sendPO(po.po_id, manager);
    expect((await db.purchase_orders.get(po.po_id))!.status).toBe('Sent');

    // 4. Vendor ships short 12 + 12 damaged on first line.
    const lines = await db.po_lines.where('po_id').equals(po.po_id).toArray();
    const first = lines[0];
    const perLine = Object.fromEntries(lines.map((l) => [l.po_line_id, { shipped: l.ordered_qty, damaged: 0, wrong: 0 }]));
    perLine[first.po_line_id] = { shipped: first.ordered_qty - 12, damaged: 12, wrong: 0 };
    await wf.vendorShip(po.po_id, 'short', perLine, '');

    // 5. Clerk receives.
    const shipped = (await db.purchase_orders.get(po.po_id))!;
    const r = await wf.submitReceipt(
      po.po_id,
      clerk,
      shipped.asn!.packing_slip_no,
      lines.map((l) => ({
        po_line_id: l.po_line_id,
        qty_received: perLine[l.po_line_id].shipped,
        qty_damaged: perLine[l.po_line_id].damaged,
        qty_wrong_item: 0,
        condition_notes: '',
      })),
    );
    expect(r.status).toBe('Partially_Accepted');
    const discs = await db.discrepancies.where('receipt_id').equals(r.receipt_id).toArray();
    expect(discs.map((d) => d.type).sort()).toEqual(['Damaged', 'Short']);
    expect(discs[0].claimed_amount).toBeCloseTo(24 * first.unit_price, 2);

    // 6. Manager approves the claim.
    const sug = await wf.getSuggestedResolutions(r.receipt_id);
    await wf.approveClaim(r.receipt_id, manager, discs[0].vendor_message, sug);
    expect((await db.discrepancies.where('receipt_id').equals(r.receipt_id).toArray()).every((d) => d.claim_status === 'Sent')).toBe(true);

    // 7. Put-away: wrong bin rejected, correct bin updates inventory.
    const tasks = await db.putaway_tasks.where('status').equals('Open').toArray();
    const milkTask = tasks.find((t) => t.product_id === first.product_id)!;
    expect(milkTask.bin_id).toBe((await db.inventory.get(`INV-${first.product_id}`))!.bin_id); // tops up its home bin
    const before = availableFor(first.product_id, await db.inventory.toArray());
    const wrong = await wf.confirmPutaway(milkTask.task_id, 'B-07-04', milkTask.qty, associate);
    expect(wrong.ok).toBe(false);
    const onHandBefore = (await db.inventory.where('product_id').equals(first.product_id).toArray()).reduce((s, i) => s + i.qty_on_hand, 0);
    const ok = await wf.confirmPutaway(milkTask.task_id, milkTask.bin_id.toLowerCase(), milkTask.qty, associate);
    expect(ok.ok).toBe(true);
    inv = await db.inventory.toArray();
    const onHandAfter = inv.filter((i) => i.product_id === first.product_id).reduce((s, i) => s + i.qty_on_hand, 0);
    expect(onHandAfter - onHandBefore).toBe(milkTask.qty);
    expect(availableFor(first.product_id, inv)).toBe(before); // moved from on-order to on-hand

    // 8. Every agent action logged with a decision.
    const log = await db.agent_action_log.toArray();
    expect(log.some((l) => l.agent_name === 'Replenishment Planner' && l.human_decision === 'Approved_With_Edits')).toBe(true);
    expect(log.some((l) => l.agent_name === 'Replenishment Planner' && l.human_decision === 'Auto_Approved')).toBe(true);
    expect(log.some((l) => l.agent_name === 'Procurement' && l.human_decision === 'Approved')).toBe(true);
    expect(log.some((l) => l.agent_name === 'Receiving Discrepancy' && l.human_decision === 'Approved')).toBe(true);
  });

  it('blocks a manager approving their own manual PR (escalates)', async () => {
    const manager = await user('U001');
    const id = await wf.createManualPR(manager, [{ product_id: 'P010', qty: 12 }], 'test');
    const pr = (await db.purchase_requisitions.get(id))!;
    expect(pr.status).toBe('Escalated');
    expect(wf.canApprovePR(pr, manager)).toMatch(/Segregation/);
  });
});
