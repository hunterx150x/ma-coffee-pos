// One shared EventSource for the whole app. Screens subscribe to event types they care about.
import { getToken } from './api.js';

const handlers = new Map(); // type -> Set<fn>
const statusListeners = new Set();
let es = null;
let connected = false;

const setConnected = (v) => {
  connected = v;
  statusListeners.forEach((fn) => fn(v));
};
const emit = (type, data) => (handlers.get(type) || []).forEach((fn) => fn(data));

function connect() {
  const token = getToken();
  if (es || !token || typeof EventSource === 'undefined') return;
  es = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
  es.addEventListener('hello', () => {
    setConnected(true);
    emit('resync'); // catch up on anything missed while disconnected
  });
  es.addEventListener('queues', (e) => emit('queues', JSON.parse(e.data || '{}')));
  es.onerror = () => {
    setConnected(false);
    // The browser retries by itself; if the server refused us (e.g. logged out) it gives up, so reopen later.
    if (es && es.readyState === EventSource.CLOSED) {
      es = null;
      setTimeout(() => handlers.size && connect(), 5000);
    }
  };
}

function disconnect() {
  if (es) es.close();
  es = null;
  setConnected(false);
}

// Phones/iPads drop the connection when the screen sleeps; reconnect and resync when visible again.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !handlers.size) return;
    if (!es || es.readyState === EventSource.CLOSED) {
      es = null;
      connect();
    } else {
      emit('resync');
    }
  });
  window.addEventListener('pos:logout', disconnect);
}

/** Subscribe to one or more event types; returns an unsubscribe function. */
export function onRealtime(types, fn) {
  const list = Array.isArray(types) ? types : [types];
  for (const t of list) {
    if (!handlers.has(t)) handlers.set(t, new Set());
    handlers.get(t).add(fn);
  }
  connect();
  return () => {
    for (const t of list) {
      handlers.get(t)?.delete(fn);
      if (!handlers.get(t)?.size) handlers.delete(t);
    }
    if (!handlers.size) disconnect();
  };
}

export function onRealtimeStatus(fn) {
  statusListeners.add(fn);
  fn(connected);
  return () => statusListeners.delete(fn);
}

export const closeRealtime = disconnect;
