'use client';
// src/components/admin/AdminHeader.tsx

import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import type { Department } from '@/lib/constants/departments';
import { Logo } from '@/components/brand/Logo';

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

        {/* Brand */}
        <div className="flex items-center gap-3">
          <Logo onDark width={120} height={30} priority />
        </div>

        {/* Right side */}
        <div className="flex items-center gap-4">
          <span className="text-white/75 text-xs font-mono">
            {displayName}
          </span>
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
