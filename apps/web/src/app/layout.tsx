import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#500000',
};

export const metadata: Metadata = {
  metadataBase: new URL('https://career-lattice-beta.vercel.app'),
  title: {
    default:  'Career Lattice | Texas A&M Engineering Workforce Development',
    template: '%s | Career Lattice',
  },
  description:
    'Explore career paths in Additive Manufacturing, Semiconductors, and the Space Industry. Find the right role, understand what skills you need, and connect with live job openings. Built by Texas A&M Engineering Workforce Development.',
  keywords: [
    'career lattice', 'career pathways', 'additive manufacturing jobs', 'semiconductor careers',
    'space industry careers', 'workforce development', 'career map', 'job skills', 'salary data',
    'Texas A&M', 'TEES',
  ],
  openGraph: {
    type:        'website',
    siteName:    'Career Lattice',
    title:       'Career Lattice | Texas A&M Engineering Workforce Development',
    description: 'Interactive career maps for Additive Manufacturing, Semiconductors, and the Space Industry.',
  },
  twitter: {
    card:        'summary_large_image',
    title:       'Career Lattice | Texas A&M Engineering Workforce Development',
    description: 'Interactive career maps for Additive Manufacturing, Semiconductors, and the Space Industry.',
  },
  robots: {
    index:  true,
    follow: true,
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className={`${inter.className} h-full bg-[#FAF7F2] text-gray-900 antialiased`}>
        {children}
      </body>
    </html>
  );
}
