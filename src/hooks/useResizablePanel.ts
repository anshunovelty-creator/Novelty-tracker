'use client';
// src/hooks/useResizablePanel.ts
// Makes a bottom-right-anchored floating panel (chat, Prepress To-Do, Meter
// Calculator) drag-resizable from any edge or corner on desktop, like a
// normal windowed app — the user explicitly asked for "all edges and
// corners", not just a single resize grip. Mobile stays at the existing
// fixed size (no handles rendered, no inline sizing applied) below
// `breakpoint`. The chosen size is remembered per widget (`id`) in
// localStorage so it persists across visits on that browser — position is
// never persisted, only size: the panel always re-anchors to its bottom-right
// corner on open, at whatever width/height the user last chose.

import { useCallback, useEffect, useRef, useState } from 'react';

export type ResizeDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

type Size = { width: number; height: number };

type Options = {
  /** Unique key for localStorage persistence, e.g. "meter-calculator". */
  id: string;
  defaultWidth: number;
  defaultHeight: number;
  minWidth?: number;
  minHeight?: number;
  /** Fixed px offset from the right edge the panel anchors to when opened (matches its `right-*` class). */
  anchorRight: number;
  /** Fixed px offset from the bottom edge the panel anchors to when opened (matches its `bottom-*` class). */
  anchorBottom: number;
  /** Below this viewport width, resizing is disabled entirely — mobile keeps the fixed Tailwind size. Default 640 (Tailwind `sm`). */
  breakpoint?: number;
  open: boolean;
};

const STORAGE_PREFIX = 'meterlabels.panelSize.';

function readStoredSize(id: string): Size | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + id);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.width === 'number' && typeof parsed?.height === 'number') return parsed;
  } catch { /* ignored — falls back to default size */ }
  return null;
}

function writeStoredSize(id: string, size: Size): void {
  try { window.localStorage.setItem(STORAGE_PREFIX + id, JSON.stringify(size)); } catch { /* ignored */ }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function useResizablePanel({
  id,
  defaultWidth,
  defaultHeight,
  minWidth = 280,
  minHeight = 280,
  anchorRight,
  anchorBottom,
  breakpoint = 640,
  open,
}: Options) {
  const [resizable, setResizable] = useState(false);
  const [size, setSize] = useState<Size>({ width: defaultWidth, height: defaultHeight });
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const dragRef = useRef<{
    dir: ResizeDirection;
    startX: number; startY: number;
    startTop: number; startLeft: number;
    startWidth: number; startHeight: number;
  } | null>(null);

  // Desktop vs. mobile — tracked live so rotating a tablet or resizing the
  // browser window doesn't leave a stale mode active.
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${breakpoint}px)`);
    setResizable(mq.matches);
    const onChange = () => setResizable(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [breakpoint]);

  // Load the remembered size once we know resizing is active.
  useEffect(() => {
    if (!resizable) return;
    const stored = readStoredSize(id);
    if (stored) setSize(stored);
  }, [id, resizable]);

  // Re-anchor to the bottom-right corner (at the current size) whenever the
  // panel opens or the viewport resizes — dragging is the only thing that
  // should move the panel away from that corner mid-session.
  useEffect(() => {
    if (!resizable || !open) return;

    function reanchor() {
      setSize((s) => {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        setPosition({
          left: clamp(vw - anchorRight - s.width, 0, Math.max(0, vw - s.width)),
          top: clamp(vh - anchorBottom - s.height, 0, Math.max(0, vh - s.height)),
        });
        return s;
      });
    }

    reanchor();
    window.addEventListener('resize', reanchor);
    return () => window.removeEventListener('resize', reanchor);
  }, [resizable, open, anchorRight, anchorBottom]);

  const startResize = useCallback((dir: ResizeDirection) => (e: React.PointerEvent) => {
    if (!resizable || !position) return;
    e.preventDefault();
    e.stopPropagation();

    dragRef.current = {
      dir,
      startX: e.clientX, startY: e.clientY,
      startTop: position.top, startLeft: position.left,
      startWidth: size.width, startHeight: size.height,
    };

    function onMove(ev: PointerEvent) {
      const ds = dragRef.current;
      if (!ds) return;
      const dx = ev.clientX - ds.startX;
      const dy = ev.clientY - ds.startY;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const maxWidth  = vw * 0.92;
      const maxHeight = vh * 0.85;

      let { startTop: top, startLeft: left, startWidth: width, startHeight: height } = ds;

      if (ds.dir.includes('e')) {
        width = clamp(ds.startWidth + dx, minWidth, maxWidth);
      }
      if (ds.dir.includes('w')) {
        width = clamp(ds.startWidth - dx, minWidth, maxWidth);
        left  = ds.startLeft + (ds.startWidth - width);
      }
      if (ds.dir.includes('s')) {
        height = clamp(ds.startHeight + dy, minHeight, maxHeight);
      }
      if (ds.dir.includes('n')) {
        height = clamp(ds.startHeight - dy, minHeight, maxHeight);
        top    = ds.startTop + (ds.startHeight - height);
      }

      left = clamp(left, 0, Math.max(0, vw - width));
      top  = clamp(top, 0, Math.max(0, vh - height));

      setPosition({ top, left });
      setSize({ width, height });
    }

    function onUp() {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      dragRef.current = null;
      setSize((s) => { writeStoredSize(id, s); return s; });
    }

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }, [resizable, position, size, minWidth, minHeight, id]);

  return {
    /** True on desktop (>= breakpoint) — render resize handles and apply inline sizing only then. */
    resizable,
    /** Inline style to spread onto the panel element when `resizable` is true; undefined on mobile (keep Tailwind classes as-is). */
    style: resizable && position
      ? { position: 'fixed' as const, top: position.top, left: position.left, width: size.width, height: size.height }
      : undefined,
    startResize,
  };
}
