'use client';
// src/components/motion/GradientMesh.tsx
// Deep-green gradient-mesh page background with drifting blobs.
// CSS-animated; respects prefers-reduced-motion via the .mesh-blob rule.
import { cn } from '@/lib/utils';

export function GradientMesh({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn('pointer-events-none fixed inset-0 -z-10 overflow-hidden mesh-bg', className)}>
      <div
        className="mesh-blob absolute -top-32 -left-24 h-96 w-96 rounded-full blur-3xl"
        style={{ background: 'radial-gradient(circle, rgba(79,165,130,.40), transparent 70%)' }}
      />
      <div
        className="mesh-blob absolute -bottom-40 -right-20 h-[28rem] w-[28rem] rounded-full blur-3xl"
        style={{ background: 'radial-gradient(circle, rgba(16,85,63,.55), transparent 70%)', animationDelay: '-6s' }}
      />
    </div>
  );
}
