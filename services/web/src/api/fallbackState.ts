type Listener = (active: boolean) => void;
let _active = false;
const listeners = new Set<Listener>();

export function setFallbackActive(v: boolean): void {
  if (_active === v) return;
  _active = v;
  listeners.forEach((l) => l(v));
}

export function isFallbackActive(): boolean {
  return _active;
}

export function subscribeFallback(l: Listener): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}
