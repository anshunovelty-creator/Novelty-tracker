'use client';
// src/app/(auth)/login/page.tsx
// useSearchParams() requires a Suspense boundary for static prerendering —
// hence the LoginForm/LoginPage split.

import React, { useState, Suspense, useRef } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useGSAP } from '@gsap/react';
import { gsap } from 'gsap';
import { registerGsap } from '@/lib/gsap/register';
import { createClient } from '@/lib/supabase/client';
import { GradientMesh } from '@/components/motion/GradientMesh';
import { LogoReveal } from '@/components/motion/LogoReveal';
import { Stagger } from '@/components/motion/Stagger';
import { LoadingButton } from '@/components/ui/Loading';
import { useBranding } from '@/components/brand/BrandingProvider';
registerGsap();

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const branding = useBranding();
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get('redirectTo') ?? '/admin';

  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const cardRef = useRef<HTMLDivElement>(null);

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

  // Card lift on mount
  useGSAP(() => {
    const el = cardRef.current;
    if (!el) return;
    const mm = gsap.matchMedia();
    mm.add('(prefers-reduced-motion: no-preference)', () =>
      gsap.fromTo(el, { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.6, ease: 'power3.out' }));
    mm.add('(prefers-reduced-motion: reduce)', () => gsap.set(el, { opacity: 1, y: 0 }));
    return () => mm.revert();
  }, { scope: cardRef });

  // Error shake
  useGSAP(() => {
    if (!error) return;
    const mm = gsap.matchMedia();
    mm.add('(prefers-reduced-motion: no-preference)', () =>
      gsap.fromTo(cardRef.current, { x: -6 }, { x: 0, ease: 'elastic.out(1,0.4)', duration: 0.5 }));
    return () => mm.revert();
  }, { dependencies: [error], scope: cardRef });

  return (
    <div className="flex min-h-screen flex-wrap bg-[#F1F5F2] text-brand-ink">
      {/* Brand panel — the dark Press Green ground the public pages share. */}
      <section className="relative flex min-h-[300px] flex-[1_1_520px] flex-col justify-between gap-10 overflow-hidden p-8 text-[#EAFFF5] sm:p-12">
        <GradientMesh className="absolute z-0" />
        <div className="relative">
          <LogoReveal onDark width={150} height={47} />
        </div>
        <div className="relative flex max-w-[460px] flex-col gap-4">
          <h1 className="text-[34px] font-semibold leading-[1.1] tracking-[-0.025em] sm:text-[44px]">
            Every job, every stage, one place.
          </h1>
          <p className="text-[17px] leading-relaxed text-[#9FBCB0]">
            The production tracker for prepress, the presses, QC and dispatch.
          </p>
        </div>
        <span className="relative font-mono text-xs font-medium uppercase tracking-[0.08em] text-brand-mint">
          {branding.name}
        </span>
      </section>

      {/* Sign-in form */}
      <section className="flex flex-[1_1_480px] items-center justify-center px-6 py-12">
        <div ref={cardRef} className="w-full max-w-[400px]" style={{ opacity: 0 }}>
          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            <div className="flex flex-col gap-1.5">
              <h2 className="text-[26px] font-semibold tracking-[-0.02em]">Sign in</h2>
              <p className="text-[15px] text-brand-muted">Use your department login.</p>
            </div>

            <Stagger className="flex flex-col gap-5">
              <label className="flex flex-col gap-1.5">
                <span className="text-[10px] font-medium uppercase tracking-[0.025em] text-brand-muted">Email</span>
                <input
                  id="email" type="email" autoComplete="email" required
                  value={email} onChange={(e) => setEmail(e.target.value)}
                  className="h-12 rounded-xl border border-brand-border bg-white px-3.5 text-base text-brand-ink focus:border-brand-primary focus:outline-none focus:shadow-[0_0_0_4px_rgba(16,85,63,0.14)]"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[10px] font-medium uppercase tracking-[0.025em] text-brand-muted">Password</span>
                <span className="relative">
                  <input
                    id="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" required
                    value={password} onChange={(e) => setPassword(e.target.value)}
                    className="h-12 w-full rounded-xl border border-brand-border bg-white pl-3.5 pr-16 text-base text-brand-ink focus:border-brand-primary focus:outline-none focus:shadow-[0_0_0_4px_rgba(16,85,63,0.14)]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-1.5 top-1/2 flex h-9 -translate-y-1/2 items-center rounded-lg px-2.5 text-xs font-semibold text-brand-primary hover:bg-brand-surface-hover"
                  >
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </span>
              </label>
            </Stagger>

            {error && (
              <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-brand-danger">
                {error}
              </p>
            )}

            <LoadingButton
              type="submit"
              loading={loading}
              loadingStages={['Connecting…', 'Verifying credentials…', 'Almost there…']}
              className="h-[52px] w-full rounded-xl bg-brand-primary text-base font-semibold text-white transition-colors hover:bg-brand-primary-hover focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-primary/30 disabled:opacity-50"
            >
              Sign in
            </LoadingButton>

            <p className="text-sm leading-normal text-brand-muted">
              Forgot it? Ask Admin to reset your department login. Customers checking an order:{' '}
              <Link href="/track" className="font-semibold text-brand-primary underline-offset-2 hover:underline">track your PO</Link>.
            </p>
          </form>
        </div>
      </section>
    </div>
  );
}
