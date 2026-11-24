import type { PRLine, Product, PurchaseRequisition, SettingsMap, User } from './types';
import { round2 } from './util';

export type ApprovalRoute = 'Auto_Approved' | 'Pending_Approval' | 'Escalated';

export interface RoutingResult {
  route: ApprovalRoute;
  total: number;
  /** user_id of the assigned approver; 'SYSTEM' when auto-approved. */
  approver_id: string | null;
  flagged: { pr_line_id: string; reason: string }[];
  reason: string;
}

export interface RoutingContext {
  /** Current available (on hand + on order) per product_id. */
  available?: Record<string, number>;
  products?: Product[];
}

export function prTotal(lines: PRLine[]): number {
  return round2(lines.reduce((s, l) => s + l.requested_qty * l.est_unit_cost, 0));
}

/** Deterministic approval routing with segregation of duties. */
export function routeForApproval(
  pr: PurchaseRequisition,
  lines: PRLine[],
  users: User[],
  settings: SettingsMap,
  ctx: RoutingContext = {},
): RoutingResult {
  const total = prTotal(lines);
  const flagged: RoutingResult['flagged'] = [];

  for (const line of lines) {
    const product = ctx.products?.find((p) => p.product_id === line.product_id);
    const avail = ctx.available?.[line.product_id] ?? 0;
    if (product && avail + line.requested_qty > 1.1 * product.max_stock) {
      flagged.push({ pr_line_id: line.pr_line_id, reason: 'Quantity would push stock above 110% of max stock' });
    }
    if (line.confidence === 'Low') {
      flagged.push({ pr_line_id: line.pr_line_id, reason: 'Forecast confidence is Low' });
    }
  }

  if (total <= settings.auto_approve_limit && flagged.length === 0 && pr.source !== 'Manual') {
    return { route: 'Auto_Approved', total, approver_id: 'SYSTEM', flagged, reason: 'Within auto-approve limit, no flags' };
  }

  const manager = users
    .filter(
      (u) =>
        u.is_active &&
        u.role === 'Store_Manager' &&
        u.approval_limit >= total &&
        u.user_id !== pr.created_by, // segregation of duties
    )
    .sort((a, b) => a.approval_limit - b.approval_limit)[0];

  if (manager) {
    const why =
      total > settings.auto_approve_limit
        ? 'Total exceeds auto-approve limit'
        : flagged.length
          ? 'One or more lines flagged'
          : 'Manual requisitions always need approval';
    return { route: 'Pending_Approval', total, approver_id: manager.user_id, flagged, reason: why };
  }

  const regional = users.find((u) => u.is_active && u.role === 'Regional_Manager' && u.user_id !== pr.created_by);
  return {
    route: 'Escalated',
    total,
    approver_id: regional?.user_id ?? null,
    flagged,
    reason: 'No eligible Store Manager (approval limit or segregation of duties) — escalated to Regional Manager',
  };
}
