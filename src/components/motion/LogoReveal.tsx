'use client';
import { useRef } from 'react';
import { useGSAP } from '@gsap/react';
import { gsap } from 'gsap';
import { registerGsap } from '@/lib/gsap/register';
import { Logo } from '@/components/brand/Logo';
registerGsap();

export function LogoReveal({ onDark = false, width = 172, height = 54, className }: { onDark?: boolean; width?: number; height?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useGSAP(() => {
    const el = ref.current;
    if (!el) return;
    const mm = gsap.matchMedia();
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      gsap.fromTo(el, { clipPath: 'inset(0 100% 0 0)', opacity: 0 },
        { clipPath: 'inset(0 0% 0 0)', opacity: 1, duration: 0.9, ease: 'power3.out' });
    });
    mm.add('(prefers-reduced-motion: reduce)', () => gsap.set(el, { clipPath: 'inset(0 0% 0 0)', opacity: 1 }));
    return () => mm.revert();
  }, { scope: ref });
  return (
    <div ref={ref} className={className} style={{ opacity: 0, display: 'inline-block' }}>
      <Logo onDark={onDark} width={width} height={height} priority />
    </div>
  );
}
