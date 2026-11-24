import { describe, expect, it } from 'vitest';
import { performThreeWayMatch } from './match';
import type { GoodsReceipt, POLine, ReceiptLine } from './types';

const receipt: GoodsReceipt = {
  receipt_id: 'GR-1',
  po_id: 'PO-1',
  received_by: 'U2',
  packing_slip_no: 'PS-1',
  received_at: '2026-11-20',
  status: 'Pending_Inspection',
};
const pol = (o: Partial<POLine> = {}): POLine => ({
  po_line_id: 'POL-1',
  po_id: 'PO-1',
  product_id: 'P1',
  ordered_qty: 120,
  unit_price: 4.4,
  received_qty: 0,
  ...o,
});
const rl = (o: Partial<ReceiptLine> = {}): ReceiptLine => ({
  receipt_line_id: 'RL-1',
  receipt_id: 'GR-1',
  po_line_id: 'POL-1',
  qty_received: 120,
  qty_accepted: 0,
  qty_damaged: 0,
  condition_notes: '',
  ...o,
});

describe('performThreeWayMatch', () => {
  it('accepts a clean full delivery and marks PO Received', () => {
    const r = performThreeWayMatch(receipt, [rl()], [pol()], null);
    expect(r.status).toBe('Accepted');
    expect(r.lines[0].qty_accepted).toBe(120);
    expect(r.lines[0].flags).toHaveLength(0);
    expect(r.poStatus).toBe('Received');
  });

  it('flags Short when shortfall exceeds tolerance', () => {
    const r = performThreeWayMatch(receipt, [rl({ qty_received: 108 })], [pol()], null);
    expect(r.lines[0].flags.map((f) => f.type)).toEqual(['Short']);
    expect(r.lines[0].flags[0].qty_variance).toBe(12);
    expect(r.status).toBe('Partially_Accepted');
    expect(r.poStatus).toBe('Partially_Received');
  });

  it('does not flag Short within tolerance (max(1, 2%))', () => {
    const r = performThreeWayMatch(receipt, [rl({ qty_received: 118 })], [pol()], null); // tol = 2.4
    expect(r.lines[0].flags).toHaveLength(0);
    expect(r.lines[0].qty_accepted).toBe(118);
  });

  it('short 12 + damaged 12: claims 12 short and 12 damaged, accepts 96', () => {
    const r = performThreeWayMatch(receipt, [rl({ qty_received: 108, qty_damaged: 12 })], [pol()], null);
    const types = Object.fromEntries(r.lines[0].flags.map((f) => [f.type, f.qty_variance]));
    expect(types).toEqual({ Short: 12, Damaged: 12 });
    expect(r.lines[0].qty_accepted).toBe(96);
  });

  it('over-shipment: accepts only open qty and flags Over', () => {
    const r = performThreeWayMatch(receipt, [rl({ qty_received: 130 })], [pol()], null);
    expect(r.lines[0].qty_accepted).toBe(120);
    expect(r.lines[0].flags[0]).toMatchObject({ type: 'Over', qty_variance: 10 });
  });

  it('uses open qty after a previous partial receipt', () => {
    const r = performThreeWayMatch(receipt, [rl({ qty_received: 20 })], [pol({ received_qty: 100 })], null);
    expect(r.lines[0].open_qty).toBe(20);
    expect(r.lines[0].flags).toHaveLength(0);
    expect(r.poStatus).toBe('Received');
  });

  it('flags Price_Mismatch when the packing slip price differs', () => {
    const r = performThreeWayMatch(receipt, [rl({ slip_unit_price: 4.6 })], [pol()], null);
    expect(r.lines[0].flags.map((f) => f.type)).toContain('Price_Mismatch');
  });

  it('flags Wrong_Item', () => {
    const r = performThreeWayMatch(receipt, [rl({ qty_received: 60, qty_wrong_item: 60 })], [pol()], null);
    expect(r.lines[0].flags.map((f) => f.type)).toEqual(['Short', 'Wrong_Item']);
  });

  it('rejects receipt when nothing is accepted', () => {
    const r = performThreeWayMatch(receipt, [rl({ qty_received: 120, qty_damaged: 120 })], [pol()], null);
    expect(r.status).toBe('Rejected');
  });

  it('notes ASN mismatches', () => {
    const r = performThreeWayMatch(receipt, [rl({ qty_received: 100 })], [pol()], {
      shipped_at: '2026-11-19',
      mode: 'full',
      packing_slip_no: 'PS-1',
      note: '',
      lines: [{ po_line_id: 'POL-1', product_id: 'P1', qty_shipped: 120, qty_damaged: 0, unit_price: 4.4 }],
    });
    expect(r.asnNotes[0]).toMatch(/ASN says 120/);
  });
});
