// src/components/brand/Logo.tsx
import Image from 'next/image';
import { cn } from '@/lib/utils';

type LogoProps = {
  /** Render white (for dark/green backgrounds). */
  onDark?: boolean;
  width?: number;
  height?: number;
  priority?: boolean;
  className?: string;
};

export function Logo({ onDark = false, width = 150, height = 47, priority = false, className }: LogoProps) {
  return (
    <Image
      src="/novelty-labels-logo.png"
      alt="Novelty Labels"
      width={width}
      height={height}
      priority={priority}
      className={cn('h-auto w-auto object-contain', onDark && '[filter:brightness(0)_invert(1)]', className)}
    />
  );
}
