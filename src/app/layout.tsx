// src/app/layout.tsx
import React from 'react';
import type { Metadata } from 'next';
import { DM_Sans, DM_Mono } from 'next/font/google';
import { Toaster } from 'react-hot-toast';
import './globals.css';

const dmSans = DM_Sans({
  subsets: ['latin'],
  variable: '--font-dm-sans',
  display: 'swap',
});

const dmMono = DM_Mono({
  subsets: ['latin'],
  variable: '--font-dm-mono',
  weight: ['300', '400', '500'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'Novelty Labels — Order Tracking',
    template: '%s | Novelty Labels',
  },
  description: 'Track your label printing orders with Novelty Labels & Supplies.',
  robots: {
    index: false,   // admin panel should not be indexed
    follow: false,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${dmSans.variable} ${dmMono.variable}`}>
      <body className="bg-brand-bg font-sans antialiased">
        {children}
        <Toaster
          position="top-right"
          toastOptions={{
            duration: 4000,
            style: {
              fontFamily: 'var(--font-dm-sans)',
              fontSize: '0.875rem',
              background: '#1a1a18',
              color: '#ffffff',
              borderRadius: '8px',
            },
          }}
        />
      </body>
    </html>
  );
}
