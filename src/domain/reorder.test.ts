import { describe, expect, it } from 'vitest';
import { checkReorderPoints } from './reorder';
import { inv, pr, prLine, product } from './fixtures';

describe('checkReorderPoints', () => {
  it('triggers Below_ROP when on hand + on order <= ROP', () => {
    const r = checkReorderPoints([product()], [inv({ qty_on_hand: 80, qty_on_order: 10 })], [], '2026-11-17');
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0].trigger).toBe('Below_ROP');
    expect(r.candidates[0].available).toBe(90);
  });

  it('sums on hand across bins and includes on order', () => {
    const r = checkReorderPoints(
      [product()],
      [inv({ qty_on_hand: 50 }), inv({ inventory_id: 'I2', bin_id: 'B-07-04', qty_on_hand: 30, qty_on_order: 20 })],
      [],
      '2026-11-17',
    );
    expect(r.candidates).toHaveLength(0); // 100 > 90 and not due for review
  });

  it('skips products with an open PR (Draft, Pending_Approval, Approved)', () => {
    for (const status of ['Draft', 'Pending_Approval', 'Approved'] as const) {
      const r = checkReorderPoints([product()], [inv({ qty_on_hand: 10 })], [{ pr: pr({ status }), lines: [prLine()] }], '2026-11-17');
      expect(r.candidates).toHaveLength(0);
    }
  });

  it('does not skip products whose PR was Rejected or Converted', () => {
    const r = checkReorderPoints([product()], [inv({ qty_on_hand: 10 })], [{ pr: pr({ status: 'Rejected' }), lines: [prLine()] }], '2026-11-17');
    expect(r.candidates).toHaveLength(1);
  });

  it('triggers Periodic_Review when review cycle elapsed and below max, and updates last_reviewed_at', () => {
    const r = checkReorderPoints([product({ last_reviewed_at: '2026-11-01' })], [inv({ qty_on_hand: 200 })], [], '2026-11-17');
    expect(r.candidates[0].trigger).toBe('Periodic_Review');
    expect(r.reviewed[0].last_reviewed_at).toBe('2026-11-17');
  });

  it('no periodic review when stock is at or above max', () => {
    const r = checkReorderPoints([product({ last_reviewed_at: '2026-11-01' })], [inv({ qty_on_hand: 420 })], [], '2026-11-17');
    expect(r.candidates).toHaveLength(0);
  });

  it('sorts by days of cover ascending', () => {
    const products = [product(), product({ product_id: 'P2', sku: 'SKU-2' })];
    const inventory = [inv({ qty_on_hand: 80 }), inv({ inventory_id: 'I2', product_id: 'P2', qty_on_hand: 60 })];
    const r = checkReorderPoints(products, inventory, [], '2026-11-17', { P1: 10, P2: 60 });
    expect(r.candidates.map((c) => c.product.product_id)).toEqual(['P2', 'P1']); // 1 day vs 8 days
  });

  it('ignores inactive products', () => {
    const r = checkReorderPoints([product({ is_active: false })], [inv({ qty_on_hand: 0 })], [], '2026-11-17');
    expect(r.candidates).toHaveLength(0);
  });
});
