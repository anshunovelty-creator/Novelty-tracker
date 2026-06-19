'use client';
import { useRef } from 'react';
import { useGSAP } from '@gsap/react';
import { gsap } from 'gsap';
import { registerGsap } from '@/lib/gsap/register';
registerGsap();

export function Stagger({ children, y = 16, each = 0.07, className }: { children: React.ReactNode; y?: number; each?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useGSAP(() => {
    const el = ref.current;
    if (!el) return;
    const items = el.children;
    const mm = gsap.matchMedia();
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      gsap.fromTo(items, { opacity: 0, y }, { opacity: 1, y: 0, duration: 0.45, ease: 'power2.out', stagger: each });
    });
    mm.add('(prefers-reduced-motion: reduce)', () => gsap.set(items, { opacity: 1, y: 0 }));
    return () => mm.revert();
  }, { scope: ref });
  return <div ref={ref} className={className}>{children}</div>;
}
