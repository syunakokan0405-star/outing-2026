import './globals.css'
import {
  Cormorant_Garamond,
  Noto_Sans_JP,
  Noto_Serif_JP,
} from 'next/font/google'

const cormorant = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-cormorant',
  display: 'swap',
})

const notoSansJP = Noto_Sans_JP({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-noto-sans-jp',
  display: 'swap',
})

const notoSerifJP = Noto_Serif_JP({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-noto-serif-jp',
  display: 'swap',
})

export const metadata = {
  title: 'Outing 2026',
  description: 'Outing 2026 event app',
  applicationName: 'Outing 2026',
  icons: {
    icon: [
      { url: '/icons/nic-dark-v2-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icons/nic-dark-v2-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: { url: '/icons/nic-dark-v2-180.png', sizes: '180x180', type: 'image/png' },
  },
  appleWebApp: {
    capable: true,
    title: 'Outing 2026',
    statusBarStyle: 'default',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html
      lang="ja"
      className={`${cormorant.variable} ${notoSansJP.variable} ${notoSerifJP.variable}`}
    >
      <body>{children}</body>
    </html>
  )
}
