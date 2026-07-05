import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#ffffff',
};

export const metadata: Metadata = {
  metadataBase: new URL('https://careerpathways.vercel.app'), // update to real domain after deploy
  title: {
    default:  'Career Pathways Platform',
    template: '%s | Career Pathways',
  },
  description:
    'Explore career paths in Additive Manufacturing and Semiconductors. Find the right role, understand what skills you need, and connect with live job openings.',
  keywords: [
    'career pathways', 'additive manufacturing jobs', 'semiconductor careers',
    'workforce development', 'career map', 'job skills', 'salary data',
  ],
  openGraph: {
    type:        'website',
    siteName:    'Career Pathways Platform',
    title:       'Career Pathways Platform',
    description: 'Interactive career maps for Additive Manufacturing, Semiconductors, and more.',
  },
  twitter: {
    card:        'summary_large_image',
    title:       'Career Pathways Platform',
    description: 'Interactive career maps for Additive Manufacturing, Semiconductors, and more.',
  },
  robots: {
    index:  true,
    follow: true,
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className={`${inter.className} h-full bg-white text-gray-900 antialiased`}>
        {children}
      </body>
    </html>
  );
}
