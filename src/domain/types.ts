// Enumerations and table row types — names match the report's ERD / data dictionary.

export type Role = 'Store_Manager' | 'Receiving_Clerk' | 'Stock_Associate' | 'Vendor' | 'Regional_Manager';

export type PRStatus = 'Draft' | 'Pending_Approval' | 'Approved' | 'Rejected' | 'Escalated' | 'Converted';
export type POStatus =
  | 'Draft'
  | 'Approved'
  | 'Sent'
  | 'Acknowledged'
  | 'Partially_Received'
  | 'Received'
  | 'Closed'
  | 'Cancelled';
export type ReceiptStatus = 'Pending_Inspection' | 'Accepted' | 'Partially_Accepted' | 'Rejected';
export type DiscrepancyType = 'Short' | 'Over' | 'Damaged' | 'Wrong_Item' | 'Price_Mismatch';
export type Resolution =
  | 'Pending'
  | 'Replacement_Requested'
  | 'Credit_Requested'
  | 'Returned'
  | 'Accepted_As_Is'
  | 'Closed';
export type HumanDecision = 'Pending' | 'Approved' | 'Approved_With_Edits' | 'Rejected' | 'Auto_Approved' | 'No_Action';
export type PRSource = 'Below_ROP' | 'Periodic_Review' | 'Manual';
export type Confidence = 'High' | 'Medium' | 'Low';
export type ReorderTrigger = 'Below_ROP' | 'Periodic_Review';
export type PutawayStatus = 'Open' | 'Completed';
export type ShipMode = 'full' | 'short' | 'damaged' | 'wrong_item';

export interface User {
  user_id: string;
  first_name: string;
  last_name: string;
  email: string;
  password_hash: string;
  role: Role;
  approval_limit: number;
  is_active: boolean;
  created_at: string;
}

export interface Product {
  product_id: string;
  sku: string;
  name: string;
  category: string;
  unit_of_measure: string;
  unit_cost: number;
  reorder_point: number;
  safety_stock: number;
  max_stock: number;
  case_pack: number;
  review_cycle_days: number;
  last_reviewed_at: string;
  is_active: boolean;
}

export interface BinLocation {
  bin_id: string;
  zone: string;
  aisle: string;
  shelf: string;
  capacity_units: number;
  temp_controlled: boolean;
}

export interface Inventory {
  inventory_id: string;
  product_id: string;
  bin_id: string;
  qty_on_hand: number;
  qty_on_order: number;
  last_counted_at: string;
}

export interface Sale {
  pos_txn_id: string;
  product_id: string;
  qty_sold: number;
  sale_datetime: string;
}

export interface Vendor {
  vendor_id: string;
  name: string;
  email: string;
  phone: string;
  rating: number;
  on_time_rate: number;
  status: 'Active' | 'Inactive';
}

export interface VendorProduct {
  vendor_id: string;
  product_id: string;
  unit_price: number;
  lead_time_days: number;
  min_order_qty: number;
  is_preferred: boolean;
}

export interface PurchaseRequisition {
  pr_id: string;
  source: PRSource;
  status: PRStatus;
  est_total_cost: number;
  ai_rationale: string;
  ai_generated: boolean;
  created_by: string | null;
  approved_by: string | null;
  created_at: string;
  approved_at: string | null;
  manager_comments: string;
  assigned_approver?: string | null;
}

export interface PRLine {
  pr_line_id: string;
  pr_id: string;
  product_id: string;
  requested_qty: number;
  est_unit_cost: number;
  confidence: Confidence;
  rationale: string;
}

export interface PurchaseOrder {
  po_id: string;
  pr_id: string;
  vendor_id: string;
  status: POStatus;
  order_date: string;
  expected_delivery_date: string;
  total_amount: number;
  tracking_number: string;
  ai_generated: boolean;
  approved_by: string | null;
  order_email: string;
  selection_note: string;
  sent_at?: string | null;
  acknowledged_at?: string | null;
  asn?: ASN | null;
  vendor_note?: string;
  followup_email?: string;
  followup_escalate?: boolean;
  /** Vendor-score snapshot used when the PO was drafted (for the score table). */
  score_snapshot?: string;
}

export interface POLine {
  po_line_id: string;
  po_id: string;
  product_id: string;
  ordered_qty: number;
  unit_price: number;
  received_qty: number;
}

/** Advance Ship Notice produced by the vendor simulator. */
export interface ASN {
  shipped_at: string;
  mode: ShipMode;
  packing_slip_no: string;
  note: string;
  lines: { po_line_id: string; product_id: string; qty_shipped: number; qty_damaged: number; unit_price: number; qty_wrong_item?: number }[];
}

export interface GoodsReceipt {
  receipt_id: string;
  po_id: string;
  received_by: string;
  packing_slip_no: string;
  received_at: string;
  status: ReceiptStatus;
}

export interface ReceiptLine {
  receipt_line_id: string;
  receipt_id: string;
  po_line_id: string;
  qty_received: number;
  qty_accepted: number;
  qty_damaged: number;
  condition_notes: string;
  slip_unit_price?: number;
  qty_wrong_item?: number;
}

export interface Discrepancy {
  discrepancy_id: string;
  receipt_line_id: string;
  type: DiscrepancyType;
  qty_variance: number;
  resolution: Resolution;
  vendor_message: string;
  resolved_by: string | null;
  resolved_at: string | null;
  receipt_id?: string;
  po_id?: string;
  product_id?: string;
  unit_price?: number;
  claim_subject?: string;
  claimed_amount?: number;
  claim_status?: 'Draft' | 'Sent';
}

export interface PutawayTask {
  task_id: string;
  receipt_line_id: string;
  product_id: string;
  bin_id: string;
  assigned_to: string;
  qty: number;
  status: PutawayStatus;
  completed_at: string | null;
}

export interface AgentActionLog {
  log_id: string;
  agent_name: AgentName;
  action_type: string;
  entity_type: string;
  entity_id: string;
  output_summary: string;
  human_decision: HumanDecision;
  decided_by: string | null;
  created_at: string;
}

export type AgentName =
  | 'Replenishment Planner'
  | 'Procurement'
  | 'Vendor Expediting'
  | 'Receiving Discrepancy'
  | 'Inventory Insights'
  | 'System Rules';

export interface Setting {
  key: string;
  value: string;
}

export interface SettingsMap {
  auto_approve_limit: number;
  ack_timeout_hours: number;
  match_tolerance_pct: number;
}
