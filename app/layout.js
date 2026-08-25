export const metadata = {
  title: 'ODYSSEY',
  description: 'Audit Management Information System',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', margin: 0, background: '#f5f5f5' }}>
        {children}
      </body>
    </html>
  );
}
