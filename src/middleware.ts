// src/middleware.ts
// ============================================================
// Auth guard middleware.
// - /admin/* → requires authenticated Supabase session
// - /track/* → public, no auth required
// - /api/cron/* → validated by CRON_SECRET header, no auth session needed
// - / → redirects authenticated users to /admin, unauthenticated to /track
// ============================================================

import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Cron jobs: validated by secret header, not Supabase auth
  if (pathname.startsWith('/api/cron/')) {
    const cronSecret = request.headers.get('x-cron-secret');
    if (cronSecret !== process.env.CRON_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.next();
  }

  // Public routes — no auth check needed
  if (pathname.startsWith('/track') || pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  // For /admin/* and / — check Supabase session
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refresh session — critical to call this in middleware
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Root redirect
  if (pathname === '/') {
    if (user) {
      return NextResponse.redirect(new URL('/admin', request.url));
    } else {
      return NextResponse.redirect(new URL('/track', request.url));
    }
  }

  // Admin routes: require authenticated user
  if (pathname.startsWith('/admin')) {
    if (!user) {
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('redirectTo', pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  // Login page: redirect to /admin if already authenticated
  if (pathname === '/login' && user) {
    return NextResponse.redirect(new URL('/admin', request.url));
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    // Match all paths except static files and Next.js internals
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
