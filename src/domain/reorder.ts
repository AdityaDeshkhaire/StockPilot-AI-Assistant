import type { Inventory, PRLine, Product, PurchaseRequisition, ReorderTrigger } from './types';
import { availableFor, daysBetween, daysOfCover } from './util';

export interface ReorderCandidate {
  product: Product;
  available: number;
  trigger: ReorderTrigger;
  days_of_cover: number;
}

export interface ReorderResult {
  candidates: ReorderCandidate[];
  /** Products whose last_reviewed_at was set to runDate (periodic review happened). */
  reviewed: Product[];
}

const OPEN_PR_STATUSES = new Set(['Draft', 'Pending_Approval', 'Approved']);

/**
 * Deterministic reorder-point check.
 * available = Σ on_hand across bins + qty_on_order.
 */
export function checkReorderPoints(
  products: Product[],
  inventory: Inventory[],
  openPRs: { pr: PurchaseRequisition; lines: PRLine[] }[],
  runDate: string,
  avgDailySales: Record<string, number> = {},
): ReorderResult {
  const blocked = new Set<string>();
  for (const { pr, lines } of openPRs) {
    if (OPEN_PR_STATUSES.has(pr.status)) lines.forEach((l) => blocked.add(l.product_id));
  }

  const candidates: ReorderCandidate[] = [];
  const reviewed: Product[] = [];

  for (const product of products) {
    if (!product.is_active || blocked.has(product.product_id)) continue;
    const available = availableFor(product.product_id, inventory);
    const cover = daysOfCover(available, avgDailySales[product.product_id] ?? 0);

    if (available <= product.reorder_point) {
      candidates.push({ product, available, trigger: 'Below_ROP', days_of_cover: cover });
    } else if (
      daysBetween(product.last_reviewed_at, runDate) >= product.review_cycle_days &&
      available < product.max_stock
    ) {
      const updated = { ...product, last_reviewed_at: runDate };
      reviewed.push(updated);
      candidates.push({ product: updated, available, trigger: 'Periodic_Review', days_of_cover: cover });
    }
  }

  candidates.sort((a, b) => a.days_of_cover - b.days_of_cover);
  return { candidates, reviewed };
}
