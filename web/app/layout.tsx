import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'SignOrder',
  description: 'Accessible food ordering by American Sign Language, speech, or touch.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      {/*
        Dark, high-contrast by default. This is a terminal in a bright room read
        from a metre away, so contrast and type size are accessibility
        requirements, not styling preferences.
      */}
      <body className="min-h-screen bg-slate-950 text-slate-100 antialiased">{children}</body>
    </html>
  );
}
