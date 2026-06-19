'use client';
// src/app/(auth)/login/page.tsx
// useSearchParams() requires a Suspense boundary for static prerendering —
// hence the LoginForm/LoginPage split.

import React, { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { Logo } from '@/components/brand/Logo';

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get('redirectTo') ?? '/admin';

  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  const supabase = createClient();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setError('Invalid email or password. Check your credentials and try again.');
      setLoading(false);
      return;
    }

    router.push(redirectTo);
    router.refresh();
  }

  return (
    <div className="min-h-screen bg-brand-bg flex items-center justify-center px-4">
      <div className="w-full max-w-sm">

        {/* Header */}
        <div className="mb-8">
          <div className="mb-6">
            <Logo width={172} height={54} priority />
          </div>
          <h1 className="text-2xl font-semibold text-brand-accent tracking-tight">
            Staff Portal
          </h1>
          <p className="text-brand-muted text-sm mt-1">
            Novelty Labels &amp; Supplies
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-brand-accent mb-1.5"
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={cn(
                'w-full px-3 py-2.5 rounded-lg border text-sm',
                'bg-white border-brand-border text-brand-accent',
                'placeholder:text-brand-muted',
                'focus:outline-none focus:ring-2 focus:ring-brand-accent/20 focus:border-brand-accent',
                'transition-colors'
              )}
              placeholder="you@noveltylabels.com"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium text-brand-accent mb-1.5"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={cn(
                'w-full px-3 py-2.5 rounded-lg border text-sm',
                'bg-white border-brand-border text-brand-accent',
                'placeholder:text-brand-muted',
                'focus:outline-none focus:ring-2 focus:ring-brand-accent/20 focus:border-brand-accent',
                'transition-colors'
              )}
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className={cn(
              'w-full bg-brand-primary text-white rounded-lg py-2.5 text-sm font-medium',
              'hover:bg-brand-primary/90 transition-colors',
              'disabled:opacity-50 disabled:cursor-not-allowed',
              'focus:outline-none focus:ring-2 focus:ring-brand-accent/30'
            )}
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="mt-6 text-xs text-brand-muted text-center">
          Access restricted to authorised staff only.
        </p>
      </div>
    </div>
  );
}
