import Dexie, { type Table } from 'dexie';
import type {
  AgentActionLog,
  BinLocation,
  Discrepancy,
  GoodsReceipt,
  Inventory,
  POLine,
  PRLine,
  Product,
  PurchaseOrder,
  PurchaseRequisition,
  PutawayTask,
  ReceiptLine,
  Sale,
  Setting,
  User,
  Vendor,
  VendorProduct,
} from '../domain/types';

export class StockPilotDB extends Dexie {
  users!: Table<User, string>;
  products!: Table<Product, string>;
  bin_locations!: Table<BinLocation, string>;
  inventory!: Table<Inventory, string>;
  sales!: Table<Sale, string>;
  vendors!: Table<Vendor, string>;
  vendor_products!: Table<VendorProduct, [string, string]>;
  purchase_requisitions!: Table<PurchaseRequisition, string>;
  pr_lines!: Table<PRLine, string>;
  purchase_orders!: Table<PurchaseOrder, string>;
  po_lines!: Table<POLine, string>;
  goods_receipts!: Table<GoodsReceipt, string>;
  receipt_lines!: Table<ReceiptLine, string>;
  discrepancies!: Table<Discrepancy, string>;
  putaway_tasks!: Table<PutawayTask, string>;
  agent_action_log!: Table<AgentActionLog, string>;
  settings!: Table<Setting, string>;

  constructor() {
    super('stockpilot');
    this.version(1).stores({
      users: 'user_id, &email, role',
      products: 'product_id, &sku, category',
      bin_locations: 'bin_id, zone',
      inventory: 'inventory_id, product_id, bin_id, &[product_id+bin_id]',
      sales: 'pos_txn_id, product_id, sale_datetime',
      vendors: 'vendor_id, &email',
      vendor_products: '[vendor_id+product_id], vendor_id, product_id',
      purchase_requisitions: 'pr_id, status, created_at',
      pr_lines: 'pr_line_id, pr_id, product_id',
      purchase_orders: 'po_id, pr_id, vendor_id, status',
      po_lines: 'po_line_id, po_id, product_id',
      goods_receipts: 'receipt_id, po_id',
      receipt_lines: 'receipt_line_id, receipt_id, po_line_id',
      discrepancies: 'discrepancy_id, receipt_line_id, receipt_id, resolution',
      putaway_tasks: 'task_id, status, assigned_to',
      agent_action_log: 'log_id, agent_name, human_decision, created_at, entity_id',
      settings: 'key',
    });
  }
}

export const db = new StockPilotDB();

export const TABLE_NAMES = [
  'users',
  'products',
  'bin_locations',
  'inventory',
  'sales',
  'vendors',
  'vendor_products',
  'purchase_requisitions',
  'pr_lines',
  'purchase_orders',
  'po_lines',
  'goods_receipts',
  'receipt_lines',
  'discrepancies',
  'putaway_tasks',
  'agent_action_log',
  'settings',
] as const;
export type TableName = (typeof TABLE_NAMES)[number];

/** Sequential human-readable IDs like PR-1001 stored in the settings table. */
export async function nextId(prefix: string): Promise<string> {
  const key = `seq_${prefix}`;
  const row = await db.settings.get(key);
  const n = row ? Number(row.value) + 1 : 1001;
  await db.settings.put({ key, value: String(n) });
  return `${prefix}-${n}`;
}
