'use client';
// src/components/admin/PanelResizeHandles.tsx
// The 8 edge/corner resize grips for a floating panel made resizable by
// useResizablePanel (src/hooks/useResizablePanel.ts). Desktop-only by
// convention — callers skip mounting this when the hook reports
// `resizable: false` (mobile). Renders as thin absolutely-positioned strips
// along each edge and small squares at each corner; the parent panel must
// be a positioning context (it already is — always `fixed`).

import type { ResizeDirection } from '@/hooks/useResizablePanel';
import { cn } from '@/lib/utils';

const CURSOR: Record<ResizeDirection, string> = {
  n: 'cursor-ns-resize',   s: 'cursor-ns-resize',
  e: 'cursor-ew-resize',   w: 'cursor-ew-resize',
  ne: 'cursor-nesw-resize', sw: 'cursor-nesw-resize',
  nw: 'cursor-nwse-resize', se: 'cursor-nwse-resize',
};

const POSITION_CLS: Record<ResizeDirection, string> = {
  n:  'top-0 left-2 right-2 h-1.5',
  s:  'bottom-0 left-2 right-2 h-1.5',
  w:  'left-0 top-2 bottom-2 w-1.5',
  e:  'right-0 top-2 bottom-2 w-1.5',
  nw: 'top-0 left-0 h-3 w-3',
  ne: 'top-0 right-0 h-3 w-3',
  sw: 'bottom-0 left-0 h-3 w-3',
  se: 'bottom-0 right-0 h-3 w-3',
};

const DIRECTIONS: ResizeDirection[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

export default function PanelResizeHandles({
  onResizeStart,
}: {
  onResizeStart: (dir: ResizeDirection) => (e: React.PointerEvent) => void;
}) {
  return (
    <>
      {DIRECTIONS.map((dir) => (
        <div
          key={dir}
          onPointerDown={onResizeStart(dir)}
          aria-hidden="true"
          className={cn('absolute z-10', CURSOR[dir], POSITION_CLS[dir])}
        />
      ))}
    </>
  );
}
