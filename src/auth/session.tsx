import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { db } from '../db/schema';
import type { Role, User } from '../domain/types';

interface Session {
  user: User | null;
  login: (email: string, password: string) => Promise<string | null>;
  logout: () => void;
  switchRole: (role: Role) => Promise<void>;
}

const Ctx = createContext<Session | null>(null);
const KEY = 'stockpilot_user';

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const id = sessionStorage.getItem(KEY);
        if (id) setUser((await db.users.get(id)) ?? null);
      } catch {
        /* storage unavailable */
      }
      setReady(true);
    })();
  }, []);

  const set = (u: User | null) => {
    setUser(u);
    try {
      if (u) sessionStorage.setItem(KEY, u.user_id);
      else sessionStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  };

  const login = async (email: string, password: string) => {
    const u = await db.users.where('email').equalsIgnoreCase(email.trim()).first();
    if (!u || u.password_hash !== password || !u.is_active) return 'Incorrect email or password.';
    set(u);
    return null;
  };

  const switchRole = async (role: Role) => {
    const u = await db.users.where('role').equals(role).first();
    if (u) set(u);
  };

  if (!ready) return null;
  return <Ctx.Provider value={{ user, login, logout: () => set(null), switchRole }}>{children}</Ctx.Provider>;
}

export function useSession() {
  const s = useContext(Ctx);
  if (!s) throw new Error('useSession outside SessionProvider');
  return s;
}

export function useUser(): User {
  const { user } = useSession();
  if (!user) throw new Error('Not logged in');
  return user;
}

export const ROLE_LABEL: Record<Role, string> = {
  Store_Manager: 'Store Manager',
  Receiving_Clerk: 'Receiving Clerk',
  Stock_Associate: 'Stock Associate',
  Vendor: 'Vendor (simulator)',
  Regional_Manager: 'Regional Manager',
};
