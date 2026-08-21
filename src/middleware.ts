// src/middleware.ts
// ============================================================
// Auth guard middleware.
// - /admin/*   → requires authenticated Supabase session
// - /display/* → production-room wall displays; also require a session
// - /track/* → public, no auth required
// - /api/cron/* → validated by CRON_SECRET header, no auth session needed
// - /api/* (mutating methods) → rejects the read-only Viewer department;
//   see the Viewer note in lib/constants/departments.ts. Individual routes
//   still do their own department checks — this is a backstop, not the
//   only gate — because a few routes (e.g. POST /api/jobs) don't check
//   department at all today and would otherwise let Viewer write there.
// - / → redirects authenticated users to /admin, unauthenticated to /track
// ============================================================

import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { getDeptPermissions } from '@/lib/constants/departments';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

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

  // Public tracking portal — no auth required
  if (pathname.startsWith('/track')) {
    return NextResponse.next();
  }

  // Every other /api/* route checks its own session, but a mutating call
  // (anything but a read) gets one extra check here: reject it outright if
  // the caller is a Viewer, regardless of whether the route remembered to
  // check department itself. An unauthenticated or non-Viewer request just
  // falls through to the route's own handling, unchanged.
  if (pathname.startsWith('/api/')) {
    if (SAFE_METHODS.has(request.method)) return NextResponse.next();

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll() {
            // No page response to attach refreshed cookies to on an API
            // request — the route handler's own client refreshes the
            // session cookie when needed.
          },
        },
      }
    );
    const { data: { user } } = await supabase.auth.getUser();
    const perms = await getDeptPermissions(user?.user_metadata?.department);
    if (perms?.isReadOnly) {
      return NextResponse.json(
        { error: 'Viewers have read-only access' },
        { status: 403 }
      );
    }
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
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
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

  // Admin routes and the production-room machine displays: require a session.
  // A room screen signs in once; the display's own polling keeps it refreshed.
  if (pathname.startsWith('/admin') || pathname.startsWith('/display')) {
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
