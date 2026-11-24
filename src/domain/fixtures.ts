// Small factories used by unit tests.
import type { BinLocation, Inventory, PRLine, Product, PurchaseRequisition, User, Vendor, VendorProduct } from './types';

export const product = (o: Partial<Product> = {}): Product => ({
  product_id: 'P1',
  sku: 'SKU-1',
  name: 'Organic Whole Milk 1 gal',
  category: 'Dairy',
  unit_of_measure: 'each',
  unit_cost: 4.4,
  reorder_point: 90,
  safety_stock: 40,
  max_stock: 420,
  case_pack: 12,
  review_cycle_days: 7,
  last_reviewed_at: '2026-11-15',
  is_active: true,
  ...o,
});

export const inv = (o: Partial<Inventory> = {}): Inventory => ({
  inventory_id: 'I1',
  product_id: 'P1',
  bin_id: 'B-07-03',
  qty_on_hand: 100,
  qty_on_order: 0,
  last_counted_at: '2026-11-01',
  ...o,
});

export const pr = (o: Partial<PurchaseRequisition> = {}): PurchaseRequisition => ({
  pr_id: 'PR-1',
  source: 'Below_ROP',
  status: 'Draft',
  est_total_cost: 0,
  ai_rationale: '',
  ai_generated: true,
  created_by: null,
  approved_by: null,
  created_at: '2026-11-17',
  approved_at: null,
  manager_comments: '',
  ...o,
});

export const prLine = (o: Partial<PRLine> = {}): PRLine => ({
  pr_line_id: 'PRL-1',
  pr_id: 'PR-1',
  product_id: 'P1',
  requested_qty: 100,
  est_unit_cost: 4.4,
  confidence: 'High',
  rationale: '',
  ...o,
});

export const user = (o: Partial<User> = {}): User => ({
  user_id: 'U1',
  first_name: 'Aditya',
  last_name: 'Deshkhaire',
  email: 'manager@stockpilot.demo',
  password_hash: 'demo123',
  role: 'Store_Manager',
  approval_limit: 10000,
  is_active: true,
  created_at: '2026-01-01',
  ...o,
});

export const vendor = (o: Partial<Vendor> = {}): Vendor => ({
  vendor_id: 'V1',
  name: 'Vendor One',
  email: 'v1@example.com',
  phone: '555-0100',
  rating: 4,
  on_time_rate: 90,
  status: 'Active',
  ...o,
});

export const vp = (o: Partial<VendorProduct> = {}): VendorProduct => ({
  vendor_id: 'V1',
  product_id: 'P1',
  unit_price: 4.0,
  lead_time_days: 3,
  min_order_qty: 1,
  is_preferred: false,
  ...o,
});

export const bin = (o: Partial<BinLocation> = {}): BinLocation => ({
  bin_id: 'B-07-01',
  zone: 'Dairy_Cooler',
  aisle: '07',
  shelf: '01',
  capacity_units: 200,
  temp_controlled: true,
  ...o,
});
