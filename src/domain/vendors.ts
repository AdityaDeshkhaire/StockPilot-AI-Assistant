import type { PRLine, Product, PurchaseRequisition, Vendor, VendorProduct } from './types';
import { round2, roundUpToCasePack } from './util';

export interface VendorScore {
  vendor_id: string;
  vendor_name: string;
  unit_price: number;
  lead_time_days: number;
  on_time_rate: number;
  rating: number;
  is_preferred: boolean;
  min_order_qty: number;
  price_score: number;
  lead_score: number;
  score: number;
  stockout_risk: boolean;
}

/** Score = 0.4·price + 0.3·lead + 0.2·on_time + 0.1·(rating×20); −25 if lead > days of cover. */
export function scoreVendors(
  productId: string,
  vendorProducts: VendorProduct[],
  vendors: Vendor[],
  daysOfCover: number,
): VendorScore[] {
  const options = vendorProducts
    .filter((vp) => vp.product_id === productId)
    .map((vp) => ({ vp, v: vendors.find((v) => v.vendor_id === vp.vendor_id) }))
    .filter((o): o is { vp: VendorProduct; v: Vendor } => !!o.v && o.v.status === 'Active');
  if (options.length === 0) return [];

  const minPrice = Math.min(...options.map((o) => o.vp.unit_price));
  const minLead = Math.min(...options.map((o) => o.vp.lead_time_days));

  const scores = options.map(({ vp, v }) => {
    const price_score = (minPrice / vp.unit_price) * 100;
    const lead_score = (minLead / vp.lead_time_days) * 100;
    let score = 0.4 * price_score + 0.3 * lead_score + 0.2 * v.on_time_rate + 0.1 * (v.rating * 20);
    const stockout_risk = vp.lead_time_days > daysOfCover;
    if (stockout_risk) score -= 25;
    return {
      vendor_id: v.vendor_id,
      vendor_name: v.name,
      unit_price: vp.unit_price,
      lead_time_days: vp.lead_time_days,
      on_time_rate: v.on_time_rate,
      rating: v.rating,
      is_preferred: vp.is_preferred,
      min_order_qty: vp.min_order_qty,
      price_score: round2(price_score),
      lead_score: round2(lead_score),
      score: round2(score),
      stockout_risk,
    };
  });

  scores.sort((a, b) => b.score - a.score);
  // Tie-break: top two within 3 points → prefer is_preferred.
  if (scores.length >= 2 && scores[0].score - scores[1].score <= 3 && !scores[0].is_preferred && scores[1].is_preferred) {
    [scores[0], scores[1]] = [scores[1], scores[0]];
  }
  return scores;
}

export interface DraftPOLine {
  pr_line_id: string;
  product_id: string;
  qty: number;
  unit_price: number;
}

export interface DraftPO {
  vendor_id: string;
  lines: DraftPOLine[];
  total: number;
  lead_time_days: number;
}

export interface VendorSelectionResult {
  pos: DraftPO[];
  lineScores: { pr_line_id: string; product_id: string; scores: VendorScore[]; chosen: string | null }[];
  unsourced: string[];
  prStatus: 'Converted';
}

export function selectVendorAndCreatePO(
  pr: PurchaseRequisition,
  lines: PRLine[],
  vendorProducts: VendorProduct[],
  vendors: Vendor[],
  products: Product[],
  daysOfCoverByProduct: Record<string, number> = {},
): VendorSelectionResult {
  void pr;
  const byVendor = new Map<string, DraftPO>();
  const lineScores: VendorSelectionResult['lineScores'] = [];
  const unsourced: string[] = [];

  for (const line of lines) {
    const product = products.find((p) => p.product_id === line.product_id);
    const cover = daysOfCoverByProduct[line.product_id] ?? Number.POSITIVE_INFINITY;
    const scores = scoreVendors(line.product_id, vendorProducts, vendors, cover);
    const best = scores[0];
    lineScores.push({ pr_line_id: line.pr_line_id, product_id: line.product_id, scores, chosen: best?.vendor_id ?? null });
    if (!best) {
      unsourced.push(line.product_id);
      continue;
    }
    const qty = roundUpToCasePack(Math.max(line.requested_qty, best.min_order_qty), product?.case_pack ?? 1);
    const po = byVendor.get(best.vendor_id) ?? { vendor_id: best.vendor_id, lines: [], total: 0, lead_time_days: 0 };
    po.lines.push({ pr_line_id: line.pr_line_id, product_id: line.product_id, qty, unit_price: best.unit_price });
    po.total = round2(po.total + qty * best.unit_price);
    po.lead_time_days = Math.max(po.lead_time_days, best.lead_time_days);
    byVendor.set(best.vendor_id, po);
  }

  return { pos: [...byVendor.values()], lineScores, unsourced, prStatus: 'Converted' };
}
