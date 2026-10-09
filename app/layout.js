import './globals.css';
import AppShell from '../components/AppShell';

export const metadata = {
  title: 'ODYSSEY',
  description: 'Audit Management Information System',
};

// Applies the saved light/dark choice before the page draws, so dark-mode
// users don't see a white flash while their profile loads.
const themeScript = `
try {
  var t = localStorage.getItem('odyssey-theme') || 'system';
  var dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
} catch (e) {}
`;

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
