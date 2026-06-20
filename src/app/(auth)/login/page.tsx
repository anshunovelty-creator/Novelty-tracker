'use client';
// src/app/(auth)/login/page.tsx
// useSearchParams() requires a Suspense boundary for static prerendering —
// hence the LoginForm/LoginPage split.

import React, { useState, Suspense, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useGSAP } from '@gsap/react';
import { gsap } from 'gsap';
import { registerGsap } from '@/lib/gsap/register';
import { createClient } from '@/lib/supabase/client';
import { GradientMesh } from '@/components/motion/GradientMesh';
import { LogoReveal } from '@/components/motion/LogoReveal';
import { Stagger } from '@/components/motion/Stagger';
import { Field } from '@/components/ui/Field';
import { LoadingButton } from '@/components/ui/Loading';
registerGsap();

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
    <div className="min-h-screen flex items-center justify-center px-4 relative overflow-hidden">
      <GradientMesh />
      <div ref={cardRef} className="w-full max-w-sm relative glass rounded-2xl p-8 shadow-2xl" style={{ opacity: 0 }}>

        {/* Header */}
        <div className="mb-8">
          <div className="mb-6">
            <LogoReveal width={172} height={54} />
          </div>
          <h1 className="text-2xl font-semibold text-[var(--glass-ink)] tracking-tight">
            Staff Portal
          </h1>
          <p className="text-[var(--glass-muted)] text-sm mt-1">
            Novelty Labels &amp; Supplies
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <Stagger className="space-y-4">
            <Field label="Email" id="email" type="email" autoComplete="email" required
                   value={email} onChange={(e) => setEmail(e.target.value)} />
            <Field label="Password" id="password" type="password" autoComplete="current-password" required
                   value={password} onChange={(e) => setPassword(e.target.value)} />
          </Stagger>

          {error && (
            <p className="text-sm text-red-200 bg-red-400/10 border border-red-300/30 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <LoadingButton
            type="submit"
            loading={loading}
            loadingStages={['Connecting…', 'Verifying credentials…', 'Almost there…']}
            className="w-full bg-brand-primary text-white rounded-lg py-2.5 text-sm font-medium hover:bg-brand-primary/90 transition-colors disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-emerald-300/40"
          >
            Sign in
          </LoadingButton>
        </form>

        <p className="mt-6 text-xs text-[var(--glass-muted)] text-center">
          Access restricted to authorised staff only.
        </p>
      </div>
    </div>
  );
}
