// src/app/layout.tsx
import React from 'react';
import type { Metadata } from 'next';
import { DM_Sans, Trispace } from 'next/font/google';
import { Toaster } from 'react-hot-toast';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { getBranding } from '@/lib/branding';
import { BrandingProvider } from '@/components/brand/BrandingProvider';
import './globals.css';

const dmSans = DM_Sans({
  subsets: ['latin'],
  variable: '--font-dm-sans',
  display: 'swap',
});

const trispace = Trispace({
  subsets: ['latin'],
  variable: '--font-trispace',
  weight: ['400', '500', '600', '700'],
  display: 'swap',
});

export async function generateMetadata(): Promise<Metadata> {
  const branding = await getBranding();
  return {
    title: {
      default: `${branding.shortName} — Order Tracking`,
      template: `%s | ${branding.shortName}`,
    },
    description: `Track your label printing orders with ${branding.name}.`,
    robots: {
      index: false,   // admin panel should not be indexed
      follow: false,
    },
  };
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const branding = await getBranding();
  return (
    <html lang="en" className={`${dmSans.variable} ${trispace.variable}`}>
      <body className="bg-brand-bg font-sans antialiased">
        <BrandingProvider branding={branding}>
          {children}
          <Toaster
            position="top-right"
            toastOptions={{
              duration: 4000,
              style: {
                fontFamily: 'var(--font-dm-sans)',
                fontSize: '0.875rem',
                background: '#0C2A20',
                color: '#ffffff',
                borderRadius: '8px',
              },
            }}
          />
        </BrandingProvider>
        <SpeedInsights />
      </body>
    </html>
  );
}
