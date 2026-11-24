import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db/schema';
import type { Product, User, Vendor } from './domain/types';

export function useSimDate(): string {
  return useLiveQuery(() => db.settings.get('sim_date'), [])?.value ?? '';
}

export function useMaps() {
  const products = useLiveQuery(() => db.products.toArray(), []) ?? [];
  const vendors = useLiveQuery(() => db.vendors.toArray(), []) ?? [];
  const users = useLiveQuery(() => db.users.toArray(), []) ?? [];
  return {
    products,
    vendors,
    users,
    product: (id?: string | null): Product | undefined => products.find((p) => p.product_id === id),
    vendor: (id?: string | null): Vendor | undefined => vendors.find((v) => v.vendor_id === id),
    user: (id?: string | null): User | undefined => users.find((u) => u.user_id === id),
    userName: (id?: string | null) => {
      if (id === 'SYSTEM') return 'System rules';
      const u = users.find((x) => x.user_id === id);
      return u ? `${u.first_name} ${u.last_name}` : '—';
    },
  };
}

export const fmtDate = (s?: string | null) => {
  if (!s) return '—';
  const d = new Date(s.length <= 10 ? s + 'T12:00:00' : s);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};
