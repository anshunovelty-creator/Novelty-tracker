'use client';
// src/lib/notify.ts
// ============================================================
// One alert for "someone wrote to you": a short chime, plus the browser's own
// notification (the system pop-up Gmail uses) whenever the user has allowed
// them — tab in front or not. Without that permission, an in-app toast while
// the tab is in front is the fallback. Used by NotesFeed (internal notes) and
// MessagesWidget (chat); NotificationPrompt asks for the permission.
//
// The chime is synthesised with Web Audio rather than shipped as a file.
// Browsers only let a page make sound after the user has interacted with it,
// so the audio context is unlocked on the first click or key press.
// ============================================================

import { createElement } from 'react';
import toast from 'react-hot-toast';

let audio: AudioContext | null = null;

function unlockAudio() {
  try {
    audio ??= new AudioContext();
    if (audio.state === 'suspended') void audio.resume();
  } catch { /* no Web Audio — alerts stay silent */ }
}

if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', unlockAudio, { once: true, capture: true });
  window.addEventListener('keydown', unlockAudio, { once: true, capture: true });
}

/** Two rising notes, ~0.5 s. Silent until the page has had a click/key press. */
function chime() {
  const ctx = audio;
  if (!ctx || ctx.state !== 'running') return;
  const t = ctx.currentTime;
  [880, 1318.5].forEach((freq, i) => {
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    const at   = t + i * 0.13;
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.2, at + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.4);
    osc.connect(gain).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + 0.42);
  });
}

const CLAIM_KEY = 'nl:notified';

function safeStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try { return window.localStorage; } catch { return null; }
}

/** With several tabs open, each gets the same Realtime event — only the first
 *  to claim an id alerts, so the chime doesn't play once per tab.
 *  ponytail: read-then-write, two tabs in the same millisecond can both win;
 *  use navigator.locks if double chimes are ever reported. */
export function claimAlert(id: string, store = safeStorage()): boolean {
  if (!store) return true;
  try {
    if (store.getItem(CLAIM_KEY) === id) return false;
    store.setItem(CLAIM_KEY, id);
  } catch { /* storage blocked — alert anyway */ }
  return true;
}

export type Alert = {
  /** The note/message id — de-duplicates across tabs and browser notifications. */
  id:     string;
  title:  string;
  body:   string;
  /** Opens whatever the alert is about (the notes drawer, the chat thread). */
  onOpen: () => void;
};

export function notify({ id, title, body, onOpen }: Alert) {
  if (!claimAlert(id)) return;
  chime();

  if ('Notification' in window && Notification.permission === 'granted') {
    // silent: the chime above is the sound; the OS one would double it.
    const n = new Notification(title, { body, tag: id, silent: true });
    n.onclick = () => { window.focus(); onOpen(); n.close(); };
    return;
  }

  if (document.visibilityState === 'visible') {
    // createElement, not JSX: keeps this a .ts module the node test runner reads.
    toast(
      (t) => createElement(
        'button',
        {
          type: 'button',
          onClick: () => { toast.dismiss(t.id); onOpen(); },
          className: 'flex max-w-xs flex-col gap-0.5 text-left',
        },
        createElement('strong', { className: 'text-sm text-white' }, title),
        createElement('span', { className: 'line-clamp-2 text-[13px] text-white/75' }, body),
      ),
      { id, duration: 6000 },
    );
  }
}
