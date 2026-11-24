import { db, TABLE_NAMES } from './schema';
import type { BinLocation, Inventory, Product, Sale, User, Vendor, VendorProduct } from '../domain/types';
import { addDays, round2, roundUpToCasePack } from '../domain/util';
import { simulatedDailySales } from '../sim/sales';

export const SIM_START = '2026-11-16'; // Monday before Thanksgiving week
export const HISTORY_DAYS = 26 * 7;

type Spec = {
  sku: string;
  name: string;
  category: string;
  uom: string;
  cost: number;
  pack: number;
  base: number; // average daily units
  bin: string;
  trigger?: boolean; // starts just above ROP so Run POS day ×2 triggers replenishment
  rop?: number;
  ss?: number;
  max?: number;
};

const SPECS: Spec[] = [
  // Dairy (temp-controlled)
  { sku: 'DAI-1001', name: 'Organic Whole Milk 1 gal', category: 'Dairy', uom: 'gallon', cost: 4.4, pack: 12, base: 25, bin: 'B-07-03', trigger: true, rop: 90, ss: 40, max: 420 },
  { sku: 'DAI-1002', name: 'Large Grade A Eggs 1 dz', category: 'Dairy', uom: 'dozen', cost: 3.3, pack: 12, base: 22, bin: 'B-07-01', trigger: true, rop: 80, ss: 35, max: 420 },
  { sku: 'DAI-1003', name: 'Sharp Cheddar Cheese 8 oz', category: 'Dairy', uom: 'each', cost: 3.3, pack: 12, base: 18, bin: 'B-07-02', trigger: true, rop: 70, ss: 30, max: 420 },
  { sku: 'DAI-1004', name: 'Greek Yogurt 32 oz', category: 'Dairy', uom: 'each', cost: 5.2, pack: 6, base: 8, bin: 'B-07-04' },
  { sku: 'DAI-1005', name: 'Unsalted Butter 1 lb', category: 'Dairy', uom: 'each', cost: 4.8, pack: 12, base: 7, bin: 'B-07-05' },
  { sku: 'DAI-1006', name: '2% Reduced Fat Milk 1 gal', category: 'Dairy', uom: 'gallon', cost: 3.9, pack: 6, base: 12, bin: 'B-08-01' },
  // Paper
  { sku: 'PAP-2001', name: 'Paper Towels 6-pk', category: 'Paper', uom: 'pack', cost: 7.5, pack: 6, base: 3, bin: 'C-04-01', trigger: true, rop: 30, ss: 12, max: 78 },
  { sku: 'PAP-2002', name: 'Bath Tissue 12-roll', category: 'Paper', uom: 'pack', cost: 9.0, pack: 6, base: 3, bin: 'C-04-02', trigger: true, rop: 30, ss: 12, max: 78 },
  { sku: 'PAP-2003', name: 'Facial Tissue 3-pk', category: 'Paper', uom: 'pack', cost: 5.25, pack: 12, base: 2, bin: 'C-04-03' },
  { sku: 'PAP-2004', name: 'Paper Plates 100 ct', category: 'Paper', uom: 'pack', cost: 4.1, pack: 12, base: 2, bin: 'C-04-04' },
  // Household
  { sku: 'HOU-3001', name: 'Dish Soap 24 oz', category: 'Household', uom: 'bottle', cost: 3.15, pack: 12, base: 4, bin: 'C-05-01' },
  { sku: 'HOU-3002', name: 'Laundry Detergent 92 oz', category: 'Household', uom: 'bottle', cost: 11.8, pack: 4, base: 2, bin: 'C-05-02' },
  { sku: 'HOU-3003', name: 'Trash Bags 13 gal 40 ct', category: 'Household', uom: 'box', cost: 7.4, pack: 6, base: 2, bin: 'C-05-03' },
  { sku: 'HOU-3004', name: 'All-Purpose Cleaner 32 oz', category: 'Household', uom: 'bottle', cost: 3.6, pack: 12, base: 2, bin: 'C-05-04' },
  // Grocery
  { sku: 'GRO-4001', name: 'Long Grain White Rice 5 lb', category: 'Grocery', uom: 'bag', cost: 4.25, pack: 8, base: 4, bin: 'A-01-01' },
  { sku: 'GRO-4002', name: 'Spaghetti 16 oz', category: 'Grocery', uom: 'box', cost: 1.15, pack: 24, base: 9, bin: 'A-01-02' },
  { sku: 'GRO-4003', name: 'Marinara Sauce 24 oz', category: 'Grocery', uom: 'jar', cost: 2.6, pack: 12, base: 6, bin: 'A-01-03' },
  { sku: 'GRO-4004', name: 'Canned Black Beans 15 oz', category: 'Grocery', uom: 'can', cost: 0.85, pack: 24, base: 10, bin: 'A-01-04' },
  { sku: 'GRO-4005', name: 'All-Purpose Flour 5 lb', category: 'Grocery', uom: 'bag', cost: 2.9, pack: 8, base: 5, bin: 'A-02-01' },
  { sku: 'GRO-4006', name: 'Canned Pumpkin 15 oz', category: 'Grocery', uom: 'can', cost: 1.55, pack: 24, base: 4, bin: 'A-02-02' },
  { sku: 'GRO-4007', name: 'Creamy Peanut Butter 16 oz', category: 'Grocery', uom: 'jar', cost: 2.75, pack: 12, base: 5, bin: 'A-02-03' },
  // Beverages
  { sku: 'BEV-5001', name: 'Sparkling Water 12-pk', category: 'Beverages', uom: 'pack', cost: 4.1, pack: 2, base: 8, bin: 'D-06-01' },
  { sku: 'BEV-5002', name: 'Cola 12-pk', category: 'Beverages', uom: 'pack', cost: 5.6, pack: 2, base: 9, bin: 'D-06-02' },
  { sku: 'BEV-5003', name: 'Bottled Water 24-pk', category: 'Beverages', uom: 'pack', cost: 3.8, pack: 1, base: 7, bin: 'D-06-03' },
  { sku: 'BEV-5004', name: 'Ground Coffee 12 oz', category: 'Beverages', uom: 'bag', cost: 6.9, pack: 6, base: 4, bin: 'D-06-04' },
  { sku: 'BEV-5005', name: 'Apple Juice 64 oz', category: 'Beverages', uom: 'bottle', cost: 2.95, pack: 8, base: 4, bin: 'D-06-05' },
  // Snacks
  { sku: 'SNK-6001', name: 'Potato Chips 8 oz', category: 'Snacks', uom: 'bag', cost: 2.4, pack: 12, base: 8, bin: 'A-02-04' },
  { sku: 'SNK-6002', name: 'Tortilla Chips 13 oz', category: 'Snacks', uom: 'bag', cost: 2.7, pack: 12, base: 6, bin: 'A-03-01' },
  { sku: 'SNK-6003', name: 'Pretzels 16 oz', category: 'Snacks', uom: 'bag', cost: 2.2, pack: 12, base: 4, bin: 'A-03-02' },
  { sku: 'SNK-6004', name: 'Trail Mix 26 oz', category: 'Snacks', uom: 'bag', cost: 6.5, pack: 6, base: 3, bin: 'A-03-03' },
];

/** Average daily demand by SKU — drives the POS simulator. */
export const BASE_DEMAND: Record<string, number> = Object.fromEntries(SPECS.map((s) => [s.sku, s.base]));

function buildBins(): BinLocation[] {
  const bins: BinLocation[] = [];
  const add = (prefix: string, zone: string, aisles: string[], shelves: number, cap: number, temp: boolean) => {
    for (const a of aisles)
      for (let s = 1; s <= shelves; s++) {
        const shelf = String(s).padStart(2, '0');
        bins.push({ bin_id: `${prefix}-${a}-${shelf}`, zone, aisle: a, shelf, capacity_units: cap, temp_controlled: temp });
      }
  };
  add('A', 'Dry_Grocery', ['01', '02', '03'], 4, 300, false);
  add('B', 'Dairy_Cooler', ['07', '08', '09'], 5, 200, true);
  add('C', 'Paper_Household', ['04', '05'], 4, 250, false);
  add('D', 'Beverages', ['06'], 5, 300, false);
  bins.push({ bin_id: 'OVF-01', zone: 'Overflow', aisle: '99', shelf: '01', capacity_units: 5000, temp_controlled: false });
  bins.push({ bin_id: 'OVF-02', zone: 'Overflow', aisle: '99', shelf: '02', capacity_units: 5000, temp_controlled: true });
  bins.push({ bin_id: 'QUA-01', zone: 'Quarantine', aisle: '98', shelf: '01', capacity_units: 5000, temp_controlled: false });
  return bins;
}

const USERS: User[] = [
  { user_id: 'U001', first_name: 'Aditya', last_name: 'Deshkhaire', email: 'manager@stockpilot.demo', password_hash: 'demo123', role: 'Store_Manager', approval_limit: 10000, is_active: true, created_at: '2026-01-05' },
  { user_id: 'U002', first_name: 'Christian', last_name: 'Liu', email: 'clerk@stockpilot.demo', password_hash: 'demo123', role: 'Receiving_Clerk', approval_limit: 0, is_active: true, created_at: '2026-01-05' },
  { user_id: 'U003', first_name: 'Nityanand', last_name: 'Agalduti', email: 'associate@stockpilot.demo', password_hash: 'demo123', role: 'Stock_Associate', approval_limit: 0, is_active: true, created_at: '2026-01-05' },
  { user_id: 'U004', first_name: 'Nigel', last_name: 'Tchobng', email: 'vendor@stockpilot.demo', password_hash: 'demo123', role: 'Vendor', approval_limit: 0, is_active: true, created_at: '2026-01-05' },
  { user_id: 'U005', first_name: 'Robert', last_name: 'Chen', email: 'regional@stockpilot.demo', password_hash: 'demo123', role: 'Regional_Manager', approval_limit: 50000, is_active: true, created_at: '2026-01-05' },
];

const VENDORS: Vendor[] = [
  { vendor_id: 'V01', name: 'FreshFarm Dairy', email: 'orders@freshfarm.example', phone: '(214) 555-0141', rating: 4.1, on_time_rate: 86, status: 'Active' },
  { vendor_id: 'V02', name: 'Lone Star Dairy Co.', email: 'po@lonestardairy.example', phone: '(972) 555-0177', rating: 4.7, on_time_rate: 97, status: 'Active' },
  { vendor_id: 'V03', name: 'Prairie Wholesale', email: 'sales@prairiewholesale.example', phone: '(469) 555-0102', rating: 3.9, on_time_rate: 90, status: 'Active' },
  { vendor_id: 'V04', name: 'Metro Paper Supply', email: 'orders@metropaper.example', phone: '(817) 555-0163', rating: 4.4, on_time_rate: 94, status: 'Active' },
  { vendor_id: 'V05', name: 'Gulf Coast Beverages', email: 'orders@gulfcoastbev.example', phone: '(713) 555-0129', rating: 4.2, on_time_rate: 92, status: 'Active' },
];

function vendorOptions(p: Spec, productId: string): VendorProduct[] {
  const o = (vendor_id: string, mult: number, lead: number, moq: number, pref = false): VendorProduct => ({
    vendor_id,
    product_id: productId,
    unit_price: round2(p.cost * mult),
    lead_time_days: lead,
    min_order_qty: moq,
    is_preferred: pref,
  });
  switch (p.category) {
    case 'Dairy':
      return [o('V01', 0.9, 7, 24), o('V02', 1.0, 2, 24, true), o('V03', 0.96, 4, 12)];
    case 'Paper':
    case 'Household':
      return [o('V04', 1.0, 3, 6, true), o('V03', 0.97, 4, 12)];
    case 'Beverages':
      return [o('V05', 1.0, 3, 12, true), o('V03', 0.95, 5, 24)];
    case 'Snacks':
      return [o('V05', 1.0, 3, 12), o('V03', 0.97, 4, 12, true)];
    default:
      return [o('V03', 1.0, 4, 12, true), o('V05', 1.04, 3, 24)];
  }
}

export async function seedDatabase(): Promise<void> {
  const bins = buildBins();
  const products: Product[] = [];
  const inventory: Inventory[] = [];
  const vendorProducts: VendorProduct[] = [];
  const sales: Sale[] = [];

  SPECS.forEach((s, i) => {
    const product_id = `P${String(i + 1).padStart(3, '0')}`;
    const rop = s.rop ?? Math.ceil(s.base * 4);
    const ss = s.ss ?? Math.ceil(s.base * 2);
    const max = s.max ?? roundUpToCasePack(s.base * 18, s.pack);
    products.push({
      product_id,
      sku: s.sku,
      name: s.name,
      category: s.category,
      unit_of_measure: s.uom,
      unit_cost: s.cost,
      reorder_point: rop,
      safety_stock: ss,
      max_stock: max,
      case_pack: s.pack,
      review_cycle_days: s.trigger ? 7 : 14,
      last_reviewed_at: addDays(SIM_START, -1),
      is_active: true,
    });

    let onHand: number;
    if (s.trigger) {
      // Just above ROP: survives POS day 1, falls to/below ROP on POS day 2.
      const d1 = simulatedDailySales(s.sku, s.category, s.base, SIM_START);
      const d2 = simulatedDailySales(s.sku, s.category, s.base, addDays(SIM_START, 1));
      onHand = rop + d1 + Math.max(1, Math.ceil(d2 / 2));
      if (onHand - d1 - d2 > rop) onHand = rop + d1 + d2; // guarantee trigger
    } else {
      const cap = bins.find((b) => b.bin_id === s.bin)!.capacity_units;
      onHand = Math.min(max, Math.round(cap * 0.8), rop + s.base * 12);
    }
    inventory.push({
      inventory_id: `INV-${product_id}`,
      product_id,
      bin_id: s.bin,
      qty_on_hand: onHand,
      qty_on_order: 0,
      last_counted_at: addDays(SIM_START, -7),
    });
    vendorProducts.push(...vendorOptions(s, product_id));

    for (let d = HISTORY_DAYS; d >= 1; d--) {
      const date = addDays(SIM_START, -d);
      const qty = simulatedDailySales(s.sku, s.category, s.base, date);
      sales.push({ pos_txn_id: `POS-${date.replace(/-/g, '')}-${s.sku}`, product_id, qty_sold: qty, sale_datetime: `${date}T20:00:00` });
    }
  });

  await db.transaction('rw', db.tables, async () => {
    await db.users.bulkPut(USERS);
    await db.vendors.bulkPut(VENDORS);
    await db.bin_locations.bulkPut(bins);
    await db.products.bulkPut(products);
    await db.inventory.bulkPut(inventory);
    await db.vendor_products.bulkPut(vendorProducts);
    await db.sales.bulkPut(sales);
    await db.settings.bulkPut([
      { key: 'auto_approve_limit', value: '1000' },
      { key: 'ack_timeout_hours', value: '48' },
      { key: 'match_tolerance_pct', value: '2' },
      { key: 'sim_date', value: SIM_START },
      { key: 'seeded', value: 'true' },
    ]);
  });
}

export async function ensureSeeded(): Promise<void> {
  const seeded = await db.settings.get('seeded');
  if (!seeded) return seedDatabase();
  // Keep demo user names in sync with the seed for databases created by older builds.
  for (const u of USERS) {
    const cur = await db.users.get(u.user_id);
    if (cur && (cur.first_name !== u.first_name || cur.last_name !== u.last_name)) {
      await db.users.update(u.user_id, { first_name: u.first_name, last_name: u.last_name });
    }
  }
}

export async function resetDemoData(): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    for (const t of TABLE_NAMES) await db.table(t).clear();
  });
  await seedDatabase();
}
