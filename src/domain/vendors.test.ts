import { describe, expect, it } from 'vitest';
import { scoreVendors, selectVendorAndCreatePO } from './vendors';
import { pr, prLine, product, vendor, vp } from './fixtures';

const vendors = [
  vendor({ vendor_id: 'CHEAP', name: 'Cheap', rating: 4, on_time_rate: 85 }),
  vendor({ vendor_id: 'FAST', name: 'Fast', rating: 4.5, on_time_rate: 97 }),
];
const vps = [
  vp({ vendor_id: 'CHEAP', unit_price: 3.9, lead_time_days: 7 }),
  vp({ vendor_id: 'FAST', unit_price: 4.4, lead_time_days: 2 }),
];

describe('scoreVendors', () => {
  it('computes the weighted score exactly', () => {
    const s = scoreVendors('P1', vps, vendors, 100);
    const cheap = s.find((x) => x.vendor_id === 'CHEAP')!;
    // price 100, lead 2/7*100=28.571, on_time 85, rating 80
    expect(cheap.score).toBeCloseTo(0.4 * 100 + 0.3 * 28.5714 + 0.2 * 85 + 0.1 * 80, 1);
  });

  it('subtracts 25 when lead time exceeds days of cover (cheapest loses)', () => {
    const s = scoreVendors('P1', vps, vendors, 3.5);
    expect(s[0].vendor_id).toBe('FAST');
    expect(s.find((x) => x.vendor_id === 'CHEAP')!.stockout_risk).toBe(true);
  });

  it('prefers is_preferred when top two are within 3 points', () => {
    const vs = [vendor({ vendor_id: 'A' }), vendor({ vendor_id: 'B' })];
    const s = scoreVendors(
      'P1',
      [vp({ vendor_id: 'A', unit_price: 4.0 }), vp({ vendor_id: 'B', unit_price: 4.1, is_preferred: true })],
      vs,
      100,
    );
    expect(s[0].vendor_id).toBe('B');
  });

  it('does not apply preference when the gap is more than 3 points', () => {
    const vs = [vendor({ vendor_id: 'A' }), vendor({ vendor_id: 'B' })];
    const s = scoreVendors('P1', [vp({ vendor_id: 'A', unit_price: 3 }), vp({ vendor_id: 'B', unit_price: 5, is_preferred: true })], vs, 100);
    expect(s[0].vendor_id).toBe('A');
  });

  it('ignores inactive vendors', () => {
    const s = scoreVendors('P1', vps, [vendors[0], { ...vendors[1], status: 'Inactive' }], 100);
    expect(s.map((x) => x.vendor_id)).toEqual(['CHEAP']);
  });
});

describe('selectVendorAndCreatePO', () => {
  it('rounds qty up to MOQ then to case pack', () => {
    const r = selectVendorAndCreatePO(
      pr(),
      [prLine({ requested_qty: 30 })],
      [vp({ min_order_qty: 50 })],
      [vendor()],
      [product({ case_pack: 12 })],
    );
    expect(r.pos[0].lines[0].qty).toBe(60);
  });

  it('rounds requested qty up to case pack when above MOQ', () => {
    const r = selectVendorAndCreatePO(pr(), [prLine({ requested_qty: 100 })], [vp()], [vendor()], [product({ case_pack: 24 })]);
    expect(r.pos[0].lines[0].qty).toBe(120);
  });

  it('groups lines by chosen vendor into one Draft PO each and converts the PR', () => {
    const lines = [prLine(), prLine({ pr_line_id: 'PRL-2', product_id: 'P2' }), prLine({ pr_line_id: 'PRL-3', product_id: 'P3' })];
    const vpsAll = [
      vp({ vendor_id: 'V1', product_id: 'P1' }),
      vp({ vendor_id: 'V1', product_id: 'P2' }),
      vp({ vendor_id: 'V2', product_id: 'P3' }),
    ];
    const r = selectVendorAndCreatePO(pr(), lines, vpsAll, [vendor(), vendor({ vendor_id: 'V2' })], [
      product(),
      product({ product_id: 'P2' }),
      product({ product_id: 'P3' }),
    ]);
    expect(r.pos).toHaveLength(2);
    expect(r.pos.find((p) => p.vendor_id === 'V1')!.lines).toHaveLength(2);
    expect(r.prStatus).toBe('Converted');
  });

  it('reports products with no vendor as unsourced', () => {
    const r = selectVendorAndCreatePO(pr(), [prLine({ product_id: 'NOPE' })], vps, vendors, [product()]);
    expect(r.unsourced).toEqual(['NOPE']);
    expect(r.pos).toHaveLength(0);
  });
});
