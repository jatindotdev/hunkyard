import type { Metadata, Viewport } from 'next';

import './globals.css';
import { SITE_DESCRIPTION, SITE_NAME } from '@/lib/site';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  userScalable: false,
  maximumScale: 1,
  viewportFit: 'cover',
  // The body uses --diffshub-sidebar-bg (#f7f7f7 / #101010) rather than
  // the plain neutral background, so it gets its own theme-color pair for the
  // browser chrome address bar.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f7f7f7' },
    { media: '(prefers-color-scheme: dark)', color: '#101010' },
  ],
};

const PROD_ORIGIN = 'https://hunkyard.app';
// In dev, point `metadataBase` at the local origin so OG previewers fetch
// in-progress assets instead of whatever's deployed.
const isDev = process.env.NODE_ENV !== 'production';
const SITE_ORIGIN = isDev ? 'http://hunkyard.localhost:4865' : PROD_ORIGIN;
const baseTitle = SITE_NAME;
const taggedTitle = baseTitle;
const description = SITE_DESCRIPTION;
const SITE_ICONS: Metadata['icons'] = {
  icon: [{ url: '/brand/icon.svg', type: 'image/svg+xml' }],
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE_ORIGIN),
  title: {
    default: taggedTitle,
    template: '%s',
  },
  description,
  icons: SITE_ICONS,
  openGraph: {
    title: {
      default: taggedTitle,
      template: '%s',
    },
    description,
  },
  twitter: {
    card: 'summary_large_image',
    title: {
      default: taggedTitle,
      template: '%s',
    },
    description,
  },
};

export { RootLayout as default } from '@/components/RootLayout';
