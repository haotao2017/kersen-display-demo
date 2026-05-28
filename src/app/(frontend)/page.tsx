import React from 'react'
import Link from 'next/link'
import configPromise from '@payload-config'
import { getPayload } from 'payload'
import { BlockRenderer } from '@/components/BlockRenderer'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const payload = await getPayload({ config: configPromise })
  const [{ docs: homePages }, { docs: pages }] = await Promise.all([
    payload.find({
      collection: 'pages',
      where: { slug: { equals: 'home' } },
      limit: 1,
      depth: 2,
    }),
    payload.find({ collection: 'pages', limit: 100, depth: 0 }),
  ])

  const homePage = homePages[0]

  if (homePage) {
    return (
      <>
        <header className="pwa-topbar">
          <Link href="/" className="pwa-brand">
            <span className="pwa-brand-mark">KD</span>
            <span>Kersen Display</span>
          </Link>
          <nav className="pwa-nav" aria-label="主导航">
            <a href="/admin" className="pwa-nav-link">
              Admin
            </a>
            <a href={`/admin/collections/pages/${homePage.id}`} className="pwa-button">
              编辑首页
            </a>
          </nav>
        </header>

        <main className="pwa-container">
          <BlockRenderer blocks={(homePage.layout as any[]) ?? []} />
        </main>
      </>
    )
  }

  return (
    <>
      <header className="pwa-topbar">
        <Link href="/" className="pwa-brand">
          <span className="pwa-brand-mark">KD</span>
          <span>Kersen Display</span>
        </Link>
        <nav className="pwa-nav" aria-label="主导航">
          <a href="/admin" className="pwa-nav-link">
            Admin
          </a>
          <a href="/admin/collections/pages/create" className="pwa-button">
            新建页面
          </a>
        </nav>
      </header>

      <main className="pwa-container">
        <section className="pwa-hero">
          <div>
            <span className="pwa-eyebrow">Payload CMS + Progressive Web App</span>
            <h1>用一个后台驱动所有 App 页面</h1>
            <p>
              在 Payload Admin 中配置页面、素材和内容区块，前台 PWA 会以深色科技风实时展示。
            </p>
            <div className="pwa-hero-actions">
              <a href="/admin" className="pwa-button">
                进入后台
              </a>
              <a href="/admin/collections/pages" className="pwa-nav-link">
                管理页面
              </a>
            </div>
          </div>
          <div className="pwa-orb-card" aria-hidden="true" />
        </section>

        {pages.length === 0 ? (
          <section className="pwa-empty">
            <span className="pwa-eyebrow">No pages yet</span>
            <h2>还没有任何页面</h2>
            <p>先在 Admin 中创建第一个页面，然后这里会自动出现可访问的 PWA 页面入口。</p>
            <a href="/admin/collections/pages/create">创建第一个页面</a>
          </section>
        ) : (
          <section className="pwa-pages-grid" aria-label="页面列表">
            {pages.map((page) => (
              <Link key={page.id} href={`/${page.slug}`} className="pwa-page-card">
                <span className="pwa-card-kicker">Page</span>
                <h2>{page.title}</h2>
                <span>/{page.slug}</span>
              </Link>
            ))}
          </section>
        )}
      </main>
    </>
  )
}
