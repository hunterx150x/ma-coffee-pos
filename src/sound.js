// Notification sounds made with the Web Audio API (no audio files to download).
// Browsers only allow sound after the page has been tapped once, so the context is unlocked on the
// first tap / key press; until then `soundState()` reports 'locked' and the bell button says so.
import { useEffect, useState } from 'react';

const KEY = 'ma_sound';
const EVENT = 'ma:sound';
let ctx = null;

export const soundEnabled = () => {
  try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; }
};
const audio = () => {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  return ctx;
};
export const soundState = () => (!soundEnabled() ? 'off' : ctx && ctx.state === 'running' ? 'on' : 'locked');

function unlock() {
  const a = audio();
  if (a && a.state !== 'running') a.resume().then(() => window.dispatchEvent(new Event(EVENT))).catch(() => {});
}
if (typeof window !== 'undefined') {
  ['pointerdown', 'keydown', 'touchstart'].forEach((ev) => window.addEventListener(ev, unlock, { passive: true }));
}

function tone(a, freq, start, dur, gain = 0.25) {
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(freq, start);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(gain, start + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  o.connect(g).connect(a.destination);
  o.start(start);
  o.stop(start + dur + 0.05);
}

/** 'order' = new customer order (two rising chimes, twice); 'notice' = payment notice (one short ding). */
export function playSound(kind = 'order') {
  if (!soundEnabled()) return false;
  const a = audio();
  if (!a || a.state !== 'running') return false;
  const t = a.currentTime + 0.02;
  if (kind === 'notice') {
    tone(a, 880, t, 0.35, 0.2);
    return true;
  }
  for (const off of [0, 0.7]) {
    tone(a, 659.25, t + off, 0.32); // E5
    tone(a, 987.77, t + off + 0.16, 0.45); // B5
  }
  return true;
}

export function useSound() {
  const [state, setState] = useState(soundState);
  useEffect(() => {
    const on = () => setState(soundState());
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  const toggle = () => {
    // On but still blocked by the browser: this tap only unlocks it (and plays a sample), it doesn't turn it off.
    const next = state === 'off' || state === 'locked';
    try { localStorage.setItem(KEY, next ? 'on' : 'off'); } catch { /* storage unavailable */ }
    if (next) {
      // this tap itself unlocks the browser's audio; play a sample so the staff know the volume
      const a = audio();
      (a && a.state !== 'running' ? a.resume() : Promise.resolve()).then(() => {
        playSound('order');
        window.dispatchEvent(new Event(EVENT));
      }).catch(() => window.dispatchEvent(new Event(EVENT)));
    }
    window.dispatchEvent(new Event(EVENT));
  };
  return { state, toggle };
}
