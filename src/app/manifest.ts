// src/app/manifest.ts
// The web app manifest. On iPhone, push notifications only work for a site
// added to the Home Screen, and this is what makes "Add to Home Screen"
// open the admin as an app (src/lib/push.ts, public/sw.js).
import type { MetadataRoute } from 'next';
import { getBranding } from '@/lib/branding';

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const branding = await getBranding();
  return {
    name:             branding.name,
    short_name:       branding.shortName,
    start_url:        '/admin',
    display:          'standalone',
    background_color: '#F4F7F5',
    theme_color:      '#10553F',
    icons:            [{ src: '/icon.png', sizes: 'any', type: 'image/png' }],
  };
}
