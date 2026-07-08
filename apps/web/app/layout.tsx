import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Agency Dashboard',
  description: 'Uptime, incidenty a expirácie pre weby agentúry.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="sk" className="h-full">
      <body className="min-h-full">
        <a href="#main" className="skip-link">
          Preskočiť na obsah
        </a>
        {children}
      </body>
    </html>
  );
}
