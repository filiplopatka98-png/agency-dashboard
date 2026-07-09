import type { Metadata } from 'next';
import './globals.css';
import { ThemeProvider } from './lib/theme';

export const metadata: Metadata = {
  title: 'Monitorix — Agency Dashboard',
  description: 'Uptime, výkon, SEO, AEO a infra pre spravované weby.',
};

// Nastav tému pred prvým paintom (bez bliknutia).
const noFlash = `(function(){try{var t=localStorage.getItem('mx-theme');if(t==='dark')document.documentElement.classList.add('dark');}catch(e){}})();`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="sk" className="h-full">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Geist+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
        <script dangerouslySetInnerHTML={{ __html: noFlash }} />
      </head>
      <body className="min-h-full">
        <a href="#main" className="skip-link">
          Preskočiť na obsah
        </a>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
