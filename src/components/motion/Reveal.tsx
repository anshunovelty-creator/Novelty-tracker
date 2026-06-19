'use client';
import { useRef } from 'react';
import { useGSAP } from '@gsap/react';
import { gsap } from 'gsap';
import { registerGsap } from '@/lib/gsap/register';
registerGsap();

type RevealProps = {
  children: React.ReactNode;
  /** animate when scrolled into view instead of on mount */
  onScroll?: boolean;
  y?: number;
  delay?: number;
  duration?: number;
  className?: string;
};

export function Reveal({ children, onScroll = false, y = 20, delay = 0, duration = 0.5, className }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  useGSAP(() => {
    const el = ref.current;
    if (!el) return;
    const mm = gsap.matchMedia();
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      gsap.fromTo(el, { opacity: 0, y },
        {
          opacity: 1, y: 0, duration, delay, ease: 'power2.out',
          scrollTrigger: onScroll ? { trigger: el, start: 'top 85%', once: true } : undefined,
        });
    });
    mm.add('(prefers-reduced-motion: reduce)', () => gsap.set(el, { opacity: 1, y: 0 }));
    return () => mm.revert();
  }, { scope: ref });
  return <div ref={ref} className={className} style={{ opacity: 0 }}>{children}</div>;
}
