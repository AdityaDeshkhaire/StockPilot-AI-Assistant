import { describe, expect, it } from 'vitest';
import { assignBinLocation } from './putaway';
import { bin, inv, product } from './fixtures';
import type { PutawayTask } from './types';

const bins = [
  bin({ bin_id: 'B-07-01', capacity_units: 100 }),
  bin({ bin_id: 'B-07-02', capacity_units: 100 }),
  bin({ bin_id: 'B-07-03', capacity_units: 200 }),
  bin({ bin_id: 'A-01-01', zone: 'Dry_Grocery', temp_controlled: false, capacity_units: 500 }),
  bin({ bin_id: 'OVF-01', zone: 'Overflow', temp_controlled: false, capacity_units: 9999 }),
  bin({ bin_id: 'QUA-01', zone: 'Quarantine', temp_controlled: false, capacity_units: 9999 }),
];

describe('assignBinLocation', () => {
  it('tops up a bin already holding the product first', () => {
    const plan = assignBinLocation(product(), 96, bins, [inv({ bin_id: 'B-07-03', qty_on_hand: 50 })], []);
    expect(plan.assignments).toEqual([{ bin_id: 'B-07-03', qty: 96, reason: 'Top_Up' }]);
  });

  it('tops up most-free-capacity bin first, then empty bins in zone', () => {
    const inventory = [
      inv({ inventory_id: 'I1', bin_id: 'B-07-01', qty_on_hand: 90 }), // free 10
      inv({ inventory_id: 'I2', bin_id: 'B-07-03', qty_on_hand: 180 }), // free 20
    ];
    const plan = assignBinLocation(product(), 100, bins, inventory, []);
    expect(plan.assignments).toEqual([
      { bin_id: 'B-07-03', qty: 20, reason: 'Top_Up' },
      { bin_id: 'B-07-01', qty: 10, reason: 'Top_Up' },
      { bin_id: 'B-07-02', qty: 70, reason: 'Empty_Bin' },
    ]);
  });

  it('never puts temp-controlled product in a non-temp bin', () => {
    const plan = assignBinLocation(product(), 50, bins, [], []);
    expect(plan.assignments.every((a) => a.bin_id.startsWith('B-'))).toBe(true);
  });

  it('respects capacity including planned open tasks', () => {
    const planned: PutawayTask[] = [
      { task_id: 'T1', receipt_line_id: 'x', product_id: 'P1', bin_id: 'B-07-03', assigned_to: 'U3', qty: 150, status: 'Open', completed_at: null },
    ];
    const plan = assignBinLocation(product(), 100, bins, [inv({ bin_id: 'B-07-03', qty_on_hand: 0 })], planned);
    expect(plan.assignments[0]).toEqual({ bin_id: 'B-07-03', qty: 50, reason: 'Top_Up' });
  });

  it('sends remainder to Overflow and notifies manager', () => {
    const plan = assignBinLocation(product(), 500, bins, [], []);
    expect(plan.overflow_qty).toBe(100);
    expect(plan.notify_manager).toBe(true);
    expect(plan.assignments.at(-1)).toEqual({ bin_id: 'OVF-01', qty: 100, reason: 'Overflow' });
  });

  it('never assigns to Quarantine', () => {
    const plan = assignBinLocation(product({ category: 'Grocery' }), 600, bins, [], []);
    expect(plan.assignments.some((a) => a.bin_id === 'QUA-01')).toBe(false);
  });
});
