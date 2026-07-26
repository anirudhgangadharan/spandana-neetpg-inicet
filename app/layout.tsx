import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'MedMCQA Practice',
  description:
    'Practice AIIMS and NEET-PG style questions from the MedMCQA research dataset. Exam preparation only — not clinical guidance.',
  applicationName: 'MedMCQA Practice',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Never block pinch-zoom: OS text scaling and zoom must work up to 200% (§10).
  maximumScale: 5,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f2f2f5' },
    { media: '(prefers-color-scheme: dark)', color: '#08080b' },
  ],
};

export default function RootLayout({
  children,
}: {
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <html lang="en">
      <body>
        {/* First tab stop: skip past the sidebar straight to the question (§10). */}
        <a className="skip-link" href="#main">
          Skip to the current question
        </a>
        {children}
      </body>
    </html>
  );
}
