import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AI Benchmark & Leaderboard Platformu',
  description:
    'LM Studio ve bulut API LLM modellerini TTFT/TPS hız metrikleriyle test eden, Deterministik + Hakem AI puanlaması yapan benchmark ve liderlik tablosu platformu',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="tr" className="dark">
      <body className="bg-gray-950 text-gray-50 min-h-screen antialiased">
        {children}
      </body>
    </html>
  );
}
