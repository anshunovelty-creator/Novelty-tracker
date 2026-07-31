'use client';
// src/components/admin/AdminHeader.tsx

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Package } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import type { Department } from '@/lib/constants/departments';
import { Logo } from '@/components/brand/Logo';
import ExportButton from './ExportButton';

type Props = {
  dept:        Department;
  displayName: string;
};

export default function AdminHeader({ dept, displayName }: Props) {
  const router = useRouter();
  const supabase = createClient();

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  return (
    <header className="bg-brand-header sticky top-0 z-40 border-b border-white/10">
      <div className="max-w-screen-2xl mx-auto px-4 h-14 flex items-center justify-between">

        {/* Brand + primary nav */}
        <div className="flex items-center gap-3 sm:gap-5 min-w-0">
          <Logo onDark width={120} height={30} priority />

          {/* Label stock is readable by every department — Dispatch and Admin
              are the only ones who can move it, enforced in /api/stock. */}
          <nav aria-label="Admin sections" className="flex items-center">
            <Link
              href="/admin/stock"
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-white/75 hover:text-white hover:bg-white/10 transition-colors whitespace-nowrap"
            >
              <Package className="h-4 w-4" aria-hidden="true" />
              Label Stock
            </Link>
          </nav>
        </div>

        {/* Right side */}
        <div className="flex items-center gap-3">
          <span className="text-white/75 text-xs font-mono hidden sm:inline">
            {displayName}
          </span>
          {/* Full-database export — Admin only, mirrored by the check in
              GET /api/export, which is the actual gate. */}
          {dept === 'Admin' && <ExportButton />}
          <button
            onClick={handleLogout}
            className="text-white/70 hover:text-white text-xs transition-colors px-2 py-1"
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
