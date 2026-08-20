import type { Metadata, Viewport } from 'next';

import './globals.css';
import { SITE_DESCRIPTION, SITE_NAME } from '@/lib/site';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  userScalable: false,
  maximumScale: 1,
  viewportFit: 'cover',
  // diffshub body uses --diffshub-sidebar-bg (#f7f7f7 / #101010) rather than
  // the plain neutral background, so it gets its own theme-color pair for the
  // browser chrome address bar.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f7f7f7' },
    { media: '(prefers-color-scheme: dark)', color: '#101010' },
  ],
};

const PROD_ORIGIN = 'https://diffshub.com';
// In dev, point `metadataBase` at localhost so OG previewers fetch
// in-progress assets instead of whatever's deployed.
const isDev = process.env.NODE_ENV !== 'production';
const DEV_PORT = process.env.PORT ?? '3692';
const SITE_ORIGIN = isDev ? `http://localhost:${DEV_PORT}` : PROD_ORIGIN;
const baseTitle = `${SITE_NAME}, from Pierre`;
const taggedTitle = baseTitle;
const description = SITE_DESCRIPTION;
const SITE_ICONS: Metadata['icons'] = {
  icon: [
    { url: '/diffshub-brand/icon.svg', type: 'image/svg+xml' },
    { url: '/diffshub-brand/icon.ico', sizes: '32x32' },
  ],
  apple: '/diffshub-brand/apple-icon.png',
};
const SITE_OG_IMAGE = '/diffshub-brand/opengraph-image.png';
const SITE_TWITTER_IMAGE = '/diffshub-brand/twitter-image.png';

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
    images: [SITE_OG_IMAGE],
  },
  twitter: {
    card: 'summary_large_image',
    title: {
      default: taggedTitle,
      template: '%s',
    },
    description,
    images: [SITE_TWITTER_IMAGE],
  },
};

export { RootLayout as default } from '@/components/RootLayout';
