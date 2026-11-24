import type { Inventory, Product } from './types';

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days between two ISO dates (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.floor((new Date(b).getTime() - new Date(a).getTime()) / DAY_MS);
}

export function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function roundUpToCasePack(qty: number, casePack: number): number {
  if (casePack <= 1) return Math.ceil(qty);
  return Math.ceil(qty / casePack) * casePack;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function onHandFor(productId: string, inventory: Inventory[]): number {
  return inventory.filter((i) => i.product_id === productId).reduce((s, i) => s + i.qty_on_hand, 0);
}

export function onOrderFor(productId: string, inventory: Inventory[]): number {
  return inventory.filter((i) => i.product_id === productId).reduce((s, i) => s + i.qty_on_order, 0);
}

export function availableFor(productId: string, inventory: Inventory[]): number {
  return onHandFor(productId, inventory) + onOrderFor(productId, inventory);
}

/** Days of cover = available / average daily sales. Infinity when there are no sales. */
export function daysOfCover(available: number, avgDaily: number): number {
  if (!avgDaily || avgDaily <= 0) return Number.POSITIVE_INFINITY;
  return available / avgDaily;
}

export function requiresTemp(product: Pick<Product, 'category'>): boolean {
  return product.category === 'Dairy';
}

/** Category → storage zone. */
export const CATEGORY_ZONE: Record<string, string> = {
  Dairy: 'Dairy_Cooler',
  Grocery: 'Dry_Grocery',
  Snacks: 'Dry_Grocery',
  Paper: 'Paper_Household',
  Household: 'Paper_Household',
  Beverages: 'Beverages',
};

export const usd = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
