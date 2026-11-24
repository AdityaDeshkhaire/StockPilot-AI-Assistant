import type { BinLocation, Inventory, Product, PutawayTask } from './types';
import { CATEGORY_ZONE, requiresTemp } from './util';

export interface BinAssignment {
  bin_id: string;
  qty: number;
  reason: 'Top_Up' | 'Empty_Bin' | 'Overflow';
}

export interface PutawayPlan {
  assignments: BinAssignment[];
  overflow_qty: number;
  notify_manager: boolean;
}

const SPECIAL_ZONES = new Set(['Overflow', 'Quarantine']);

/** Free capacity = capacity − on-hand of all products in the bin − qty already planned for open tasks. */
export function freeCapacity(bin: BinLocation, inventory: Inventory[], planned: PutawayTask[]): number {
  const used = inventory.filter((i) => i.bin_id === bin.bin_id).reduce((s, i) => s + i.qty_on_hand, 0);
  const plannedQty = planned.filter((t) => t.bin_id === bin.bin_id && t.status === 'Open').reduce((s, t) => s + t.qty, 0);
  return Math.max(0, bin.capacity_units - used - plannedQty);
}

export function assignBinLocation(
  product: Product,
  qty: number,
  bins: BinLocation[],
  inventory: Inventory[],
  plannedTasks: PutawayTask[],
): PutawayPlan {
  const assignments: BinAssignment[] = [];
  let remaining = qty;
  const needTemp = requiresTemp(product);
  const zone = CATEGORY_ZONE[product.category];
  const used = new Set<string>();

  // 1. Top up bins already holding this product, most free capacity first.
  const holding = bins
    .filter((b) => !SPECIAL_ZONES.has(b.zone) && b.temp_controlled === needTemp)
    .filter((b) => inventory.some((i) => i.bin_id === b.bin_id && i.product_id === product.product_id))
    .map((b) => ({ b, free: freeCapacity(b, inventory, plannedTasks) }))
    .filter((x) => x.free > 0)
    .sort((a, b) => b.free - a.free);
  for (const { b, free } of holding) {
    if (remaining <= 0) break;
    const q = Math.min(free, remaining);
    assignments.push({ bin_id: b.bin_id, qty: q, reason: 'Top_Up' });
    used.add(b.bin_id);
    remaining -= q;
  }

  // 2. Empty compatible bins in the product's zone.
  if (remaining > 0) {
    const empty = bins
      .filter((b) => !used.has(b.bin_id) && b.zone === zone && b.temp_controlled === needTemp)
      .filter(
        (b) =>
          !inventory.some((i) => i.bin_id === b.bin_id && i.qty_on_hand > 0) &&
          !plannedTasks.some((t) => t.bin_id === b.bin_id && t.status === 'Open'),
      )
      .sort((a, b) => a.bin_id.localeCompare(b.bin_id));
    for (const b of empty) {
      if (remaining <= 0) break;
      const q = Math.min(b.capacity_units, remaining);
      assignments.push({ bin_id: b.bin_id, qty: q, reason: 'Empty_Bin' });
      remaining -= q;
    }
  }

  // 3. Remainder → Overflow + notify manager.
  let overflow_qty = 0;
  if (remaining > 0) {
    const overflow = bins.find((b) => b.zone === 'Overflow');
    if (overflow) assignments.push({ bin_id: overflow.bin_id, qty: remaining, reason: 'Overflow' });
    overflow_qty = remaining;
  }

  return { assignments, overflow_qty, notify_manager: overflow_qty > 0 };
}
