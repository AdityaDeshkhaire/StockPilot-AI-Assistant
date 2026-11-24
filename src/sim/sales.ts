// Deterministic sales generator used by both the seed history and the "Run POS day" simulator.

/** FNV-1a hash → [0,1). Same inputs always give the same number. */
export function rand01(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 0) % 100000) / 100000;
}

// Sun..Sat
const DOW = [1.2, 0.85, 0.85, 0.95, 1.0, 1.15, 1.3];

const HOLIDAY_CATEGORIES = new Set(['Dairy', 'Grocery', 'Snacks', 'Beverages']);

/** Thanksgiving = 4th Thursday of November. */
export function thanksgiving(year: number): Date {
  const d = new Date(Date.UTC(year, 10, 1));
  const firstThu = (4 - d.getUTCDay() + 7) % 7;
  return new Date(Date.UTC(year, 10, 1 + firstThu + 21));
}

export function seasonality(isoDate: string, category: string): number {
  const d = new Date(isoDate + 'T00:00:00Z');
  const tg = thanksgiving(d.getUTCFullYear());
  const diff = (d.getTime() - tg.getTime()) / 86400000;
  if (HOLIDAY_CATEGORIES.has(category) && diff >= -5 && diff <= 1) return 1.5; // Thanksgiving week bump
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  if ((category === 'Beverages' || category === 'Snacks') && m === 6 && day <= 5) return 1.3; // July 4th
  if ((category === 'Beverages' || category === 'Snacks') && (m === 5 || m === 6 || m === 7)) return 1.1; // summer
  return 1;
}

export function simulatedDailySales(sku: string, category: string, base: number, isoDate: string): number {
  const d = new Date(isoDate + 'T00:00:00Z');
  const r = rand01(`${sku}|${isoDate}`);
  const qty = base * DOW[d.getUTCDay()] * seasonality(isoDate, category) * (0.85 + 0.3 * r);
  return Math.max(0, Math.round(qty));
}
