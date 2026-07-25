// src/app/display/layout.tsx
// Shell for the production-room wall displays. Deliberately chrome-free: no
// header, no nav, no footer links — a projected screen has no one to click it.
// Keeps the dark "Control Room" mesh (DESIGN.md north star): the admin light
// theme glares badly through a projector, dark reads well across a room.

import React from 'react';
import type { Metadata } from 'next';
import { GradientMesh } from '@/components/motion/GradientMesh';

export const metadata: Metadata = {
  title: 'Machine Display',
  robots: { index: false, follow: false },
};

export default function DisplayLayout({ children }: { children: React.ReactNode }) {
  // bg-green-950 is the floor under the mesh: the app body is a light warm
  // white, so anything falling outside the fixed mesh would put pale glass
  // text on near-white. The mesh is lifted to z-0 (it defaults to -z-10, which
  // would put it behind that floor and hide it) and the content sits above it.
  return (
    <div className="relative min-h-[100dvh] bg-green-950 text-[var(--glass-ink)]">
      <GradientMesh className="z-0" />
      <main className="relative z-10">{children}</main>
    </div>
  );
}
