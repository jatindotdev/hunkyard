import type { MetadataRoute } from 'next';

import { SITE_DESCRIPTION, SITE_NAME } from '@/lib/site';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_NAME,
    short_name: SITE_NAME,
    description: SITE_DESCRIPTION,
    id: '/',
    start_url: '/',
    display: 'standalone',
    orientation: 'any',
    lang: 'en',
    dir: 'ltr',
    background_color: '#ffffff',
    // The body uses --diffshub-sidebar-bg (#f7f7f7) rather than plain white.
    // The manifest only accepts a single theme_color, so we use the light
    // value; dark-mode tinting is handled via themeColor in the viewport.
    theme_color: '#f7f7f7',
    categories: ['developer', 'productivity'],
    icons: [
      {
        src: '/brand/icon.svg',
        type: 'image/svg+xml',
        sizes: 'any',
        purpose: 'any',
      },
    ],
  };
}
