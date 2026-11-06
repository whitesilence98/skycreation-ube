import type { Metadata, Viewport } from 'next';
import { Cinzel, Inter } from 'next/font/google';
import './globals.css';

const cinzel = Cinzel({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-cinzel',
  display: 'swap',
});

const inter = Inter({
  subsets: ['latin'],
  weight: ['200', '300', '400', '500'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Character Creation — Lyra',
  description:
    'Dark-fantasy character creation HUD driven by Skyrim SE RaceMenu / XPMSSE assets.',
};

export const viewport: Viewport = {
  themeColor: '#07070a',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${cinzel.variable} ${inter.variable}`}>
      <body>{children}</body>
    </html>
  );
}
