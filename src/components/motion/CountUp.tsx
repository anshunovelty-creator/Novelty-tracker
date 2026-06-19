'use client';
import { useRef } from 'react';
import { useGSAP } from '@gsap/react';
import { gsap } from 'gsap';
import { registerGsap } from '@/lib/gsap/register';
registerGsap();

export function CountUp({ value, duration = 0.9, className }: { value: number; duration?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useGSAP(() => {
    const el = ref.current;
    if (!el) return;
    const obj = { n: 0 };
    const render = () => { el.textContent = String(Math.round(obj.n)); };
    const mm = gsap.matchMedia();
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      gsap.to(obj, { n: value, duration, ease: 'power1.out', onUpdate: render });
    });
    mm.add('(prefers-reduced-motion: reduce)', () => { obj.n = value; render(); });
    return () => mm.revert();
  }, { dependencies: [value], scope: ref });
  return <span ref={ref} className={className}>0</span>;
}
