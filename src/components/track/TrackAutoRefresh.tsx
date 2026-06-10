'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

type Props = {
  intervalMs?: number;
};

export default function TrackAutoRefresh({ intervalMs = 30000 }: Props) {
  const router = useRouter();

  useEffect(() => {
    const refresh = () => router.refresh();
    const timer = window.setInterval(refresh, intervalMs);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refresh();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [intervalMs, router]);

  return null;
}