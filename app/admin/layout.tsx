import type { Metadata } from 'next'

export const metadata: Metadata = {
  manifest: '/admin/manifest.webmanifest',
  applicationName: 'Outing 2026 管理',
  appleWebApp: {
    capable: true,
    title: 'Outing 管理',
    statusBarStyle: 'default',
  },
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children
}
