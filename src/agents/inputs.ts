// Input payloads sent to each agent (as JSON).
import type { VendorScore } from '../domain/vendors';

export interface ReplenishmentInput {
  run_date: string;
  upcoming_events: { name: string; date: string }[];
  items: {
    product_id: string;
    sku: string;
    name: string;
    category: string;
    trigger: string;
    on_hand: number;
    on_order: number;
    available: number;
    reorder_point: number;
    safety_stock: number;
    max_stock: number;
    case_pack: number;
    unit_cost: number;
    review_cycle_days: number;
    avg_daily_sales_28d: number;
    last_7_days_sales: number[];
    days_of_cover: number | null;
    best_lead_time_days: number;
    rule_based_qty: number;
  }[];
}

export interface ProcurementInput {
  pr_id: string;
  ship_to: string;
  lines: { product_id: string; name: string; requested_qty: number; days_of_cover: number | null; scores: VendorScore[]; chosen_vendor_id: string | null }[];
  po_drafts: {
    po_id: string;
    vendor_id: string;
    vendor_name: string;
    vendor_email: string;
    expected_delivery_date: string;
    total: number;
    lines: { product_id: string; name: string; qty: number; unit_price: number }[];
  }[];
  revision_instruction?: string;
}

export interface ExpeditingInput {
  mode: 'followup' | 'parse_note';
  po_id: string;
  vendor_name: string;
  order_date: string;
  expected_delivery_date: string;
  hours_since_sent: number;
  ack_timeout_hours: number;
  vendor_note?: string;
  today: string;
}

export interface DiscrepancyInput {
  po_id: string;
  receipt_id: string;
  packing_slip_no: string;
  vendor: { name: string; email: string };
  discrepancies: {
    discrepancy_id: string;
    product_id: string;
    product_name: string;
    category: string;
    type: string;
    qty_variance: number;
    unit_price: number;
    line_value: number;
  }[];
  asn_notes: string[];
  instruction?: string;
}

export interface InsightsInput {
  week_ending: string;
  kpis: Record<string, number>;
  low_stock: { product_id: string; name: string; available: number; reorder_point: number; days_of_cover: number | null }[];
  open_pos: { po_id: string; vendor: string; status: string; expected: string; total: number }[];
  open_discrepancies: { discrepancy_id: string; type: string; product: string; qty: number }[];
  top_sellers: { product_id: string; name: string; units_7d: number }[];
  slow_movers: { product_id: string; name: string; units_7d: number }[];
  category_sales: { category: string; last_7: number; prior_7: number }[];
}
