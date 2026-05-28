import React, { Suspense } from 'react'
import { getPayload } from 'payload'
import configPromise from '@payload-config'

async function DashboardStats() {
  const payload = await getPayload({ config: configPromise })

  const [pagesRes, mediaRes, usersRes, recentPages] = await Promise.all([
    payload.find({ collection: 'pages', limit: 0, pagination: false, depth: 0 }),
    payload.find({ collection: 'media', limit: 0, pagination: false, depth: 0 }),
    payload.find({ collection: 'users', limit: 0, pagination: false, depth: 0 }),
    payload.find({ collection: 'pages', limit: 6, sort: '-updatedAt', depth: 0 }),
  ])

  const stats = [
    {
      kicker: 'CMS',
      count: pagesRes.totalDocs,
      label: '页面',
      helper: '可发布的 App 页面',
      chip: '创建页面',
      href: '/admin/collections/pages/create',
    },
    {
      kicker: 'ASSETS',
      count: mediaRes.totalDocs,
      label: '媒体文件',
      helper: '图片和内容素材',
      chip: '上传素材',
      href: '/admin/collections/media/create',
    },
    {
      kicker: 'ACCESS',
      count: usersRes.totalDocs,
      label: '用户',
      helper: '后台操作账号',
      chip: '管理用户',
      href: '/admin/collections/users',
    },
  ]

  const now = new Date()
  const hour = now.getHours()
  const greeting = hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好'

  return (
    <div className="kd-dashboard">
      <section className="kd-command-center">
        <div className="kd-command-copy">
          <span className="kd-eyebrow">Kersen Display Command Center</span>
          <h1>{greeting}，准备发布新的 PWA 体验</h1>
          <p>集中管理页面、素材和后台账号，所有内容会实时驱动前台 App 展示。</p>
        </div>
        <div className="kd-command-panel">
          <span>System</span>
          <strong>Online</strong>
          <small>Payload CMS + PWA</small>
        </div>
      </section>

      <div className="kd-actions-grid" aria-label="快捷操作">
        <a href="/admin/collections/pages/create" className="kd-action-btn">
          新建页面
        </a>
        <a href="/admin/collections/media/create" className="kd-action-btn kd-action-btn-ghost">
          上传媒体
        </a>
        <a href="/" className="kd-action-btn kd-action-btn-ghost">
          预览 PWA
        </a>
      </div>

      <div className="kd-stats-grid">
        {stats.map((s) => (
          <a key={s.label} href={s.href} className="kd-stat-card">
            <span className="kd-stat-kicker">{s.kicker}</span>
            <div className="kd-stat-main">
              <div className="kd-stat-count">{s.count}</div>
              <div className="kd-stat-label">{s.label}</div>
            </div>
            <p>{s.helper}</p>
            <div className="kd-stat-chip">{s.chip}</div>
          </a>
        ))}
      </div>

      <div className="kd-section">
        <div className="kd-section-header">
          <div>
            <p className="kd-section-kicker">CONTENT OPS</p>
            <h2 className="kd-section-title">最近编辑</h2>
          </div>
          <a href="/admin/collections/pages" className="kd-section-link">
            查看全部
          </a>
        </div>
        {recentPages.docs.length > 0 ? (
          (recentPages.docs as any[]).map((page) => (
            <a
              key={page.id}
              href={`/admin/collections/pages/${page.id}`}
              className="kd-page-row"
            >
              <div className="kd-page-dot" />
              <span className="kd-page-title">{page.title}</span>
              <span className="kd-page-slug">/{page.slug}</span>
              <span className="kd-page-date">
                {new Date(page.updatedAt).toLocaleDateString('zh-CN', {
                  month: 'short',
                  day: 'numeric',
                })}
              </span>
              <span className="kd-page-arrow">Open</span>
            </a>
          ))
        ) : (
          <div className="kd-empty-state">
            <strong>还没有页面内容</strong>
            <p>先创建一个页面，再回到这里查看最近编辑记录。</p>
            <a href="/admin/collections/pages/create">创建第一个页面</a>
          </div>
        )}
      </div>
    </div>
  )
}

function DashboardSkeleton() {
  return (
    <div className="kd-dashboard">
      <div className="kd-command-center">
        <div className="kd-command-copy">
          <div className="kd-skeleton" style={{ width: 180, height: 14 }} />
          <div className="kd-skeleton" style={{ width: '70%', height: 44 }} />
          <div className="kd-skeleton" style={{ width: '54%', height: 18 }} />
        </div>
        <div className="kd-skeleton kd-command-panel" />
      </div>

      <div className="kd-stats-grid">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="kd-stat-card"
            style={{ pointerEvents: 'none', gap: '0.75rem' }}
          >
            <div className="kd-skeleton" style={{ width: 72, height: 12 }} />
            <div className="kd-skeleton" style={{ width: 68, height: 44 }} />
            <div className="kd-skeleton" style={{ width: 64, height: 12 }} />
            <div className="kd-skeleton" style={{ width: 88, height: 26, borderRadius: 20 }} />
          </div>
        ))}
      </div>

      <div className="kd-section">
        <div className="kd-section-header">
          <div className="kd-skeleton" style={{ width: 120, height: 16 }} />
        </div>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="kd-page-row" style={{ pointerEvents: 'none' }}>
            <div className="kd-skeleton" style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0 }} />
            <div className="kd-skeleton" style={{ flex: 1, height: 15 }} />
            <div className="kd-skeleton" style={{ width: 60, height: 13 }} />
            <div className="kd-skeleton" style={{ width: 40, height: 13 }} />
          </div>
        ))}
      </div>
    </div>
  )
}

export default function CustomDashboard() {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <DashboardStats />
    </Suspense>
  )
}
