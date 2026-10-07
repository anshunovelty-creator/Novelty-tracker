'use client';
// src/components/admin/AdminSectionNav.tsx
// The pill row above Team, Departments and Settings — the three admin-only
// pages that configure the app rather than run production. One row so they
// read as one place, whichever of them the header link lands on.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const SECTIONS = [
  { href: '/admin/team',        label: 'Team' },
  { href: '/admin/departments', label: 'Departments' },
  { href: '/admin/settings',    label: 'Settings' },
] as const;

export default function AdminSectionNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Admin" className="flex flex-wrap gap-1">
      {SECTIONS.map((s) => {
        const on = pathname === s.href || pathname?.startsWith(`${s.href}/`);
        return (
          <Link
            key={s.href}
            href={s.href}
            aria-current={on ? 'page' : undefined}
            className={cn(
              'flex min-h-10 items-center rounded-full px-3.5 text-sm font-medium transition-colors',
              on ? 'bg-brand-ink text-white' : 'text-brand-muted hover:bg-brand-border hover:text-brand-ink',
            )}
          >
            {s.label}
          </Link>
        );
      })}
    </nav>
  );
}
