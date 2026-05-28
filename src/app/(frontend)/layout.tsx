import React from 'react'
import type { Metadata, Viewport } from 'next'
import { ServiceWorkerRegister } from '@/components/ServiceWorkerRegister'

export const metadata: Metadata = {
  title: 'Kersen Display PWA',
  description: 'CMS-driven PWA powered by Payload.',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Kersen PWA',
  },
}

export const viewport: Viewport = {
  themeColor: '#050816',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default function FrontendLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="pwa-app">
      <ServiceWorkerRegister />
      <div className="pwa-shell">{children}</div>
    </div>
  )
}
