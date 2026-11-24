// Tiny pub-sub so services can surface agent errors / notices to the UI.
export interface Notice {
  id: number;
  kind: 'error' | 'info' | 'success' | 'warning';
  title: string;
  body?: string;
}

type Listener = (n: Notice) => void;
const listeners = new Set<Listener>();
let seq = 1;

export function notify(n: Omit<Notice, 'id'>) {
  const notice = { ...n, id: seq++ };
  listeners.forEach((l) => l(notice));
}

export function subscribe(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
