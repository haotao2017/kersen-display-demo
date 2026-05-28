import React from 'react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import configPromise from '@payload-config'
import { getPayload } from 'payload'
import { BlockRenderer } from '@/components/BlockRenderer'

export default async function DynamicPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const payload = await getPayload({ config: configPromise })

  const { docs } = await payload.find({
    collection: 'pages',
    where: { slug: { equals: slug } },
    limit: 1,
    depth: 2,
  })

  if (!docs[0]) notFound()

  const page = docs[0]

  return (
    <>
      <nav className="pwa-topbar">
        <Link href="/" className="pwa-brand">
          <span className="pwa-brand-mark">KD</span>
          <span>Kersen Display</span>
        </Link>
        <div className="pwa-nav">
          <Link href="/" className="pwa-back-link">
            所有页面
          </Link>
          <a href={`/admin/collections/pages/${page.id}`} className="pwa-edit-link">
            在 Admin 编辑
          </a>
        </div>
      </nav>

      <main className="pwa-container">
        <header className="pwa-page-header">
          <span className="pwa-page-title">{page.title}</span>
          <span className="pwa-eyebrow">/{page.slug}</span>
        </header>
        <BlockRenderer blocks={(page.layout as any[]) ?? []} />
      </main>
    </>
  )
}

export const dynamic = 'force-dynamic'
