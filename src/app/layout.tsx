import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AI Benchmark Platform',
  description: 'LLM model benchmark ve liderlik tablosu platformu',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr" className="dark">
      <body className="bg-gray-900 text-white min-h-screen">{children}</body>
    </html>
  );
}