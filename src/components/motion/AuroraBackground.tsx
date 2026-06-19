'use client';
import { useRef } from 'react';
import { useGSAP } from '@gsap/react';
import { gsap } from 'gsap';
import { registerGsap } from '@/lib/gsap/register';
registerGsap();

export function AuroraBackground({ className }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useGSAP(() => {
    const blobs = ref.current?.querySelectorAll('[data-blob]');
    if (!blobs?.length) return;
    const mm = gsap.matchMedia();
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      blobs.forEach((b, i) => {
        gsap.to(b, { xPercent: i ? -12 : 12, yPercent: i ? 10 : -10, scale: 1.15,
          duration: 9 + i * 3, repeat: -1, yoyo: true, ease: 'sine.inOut' });
      });
    });
    return () => mm.revert();
  }, { scope: ref });
  return (
    <div ref={ref} aria-hidden className={`pointer-events-none absolute inset-0 -z-10 overflow-hidden ${className ?? ''}`}>
      <div data-blob className="absolute -top-24 -left-16 h-80 w-80 rounded-full blur-3xl"
           style={{ background: 'radial-gradient(circle, rgba(79,165,130,.45), transparent 70%)' }} />
      <div data-blob className="absolute -bottom-24 -right-10 h-96 w-96 rounded-full blur-3xl"
           style={{ background: 'radial-gradient(circle, rgba(16,85,63,.55), transparent 70%)' }} />
    </div>
  );
}
