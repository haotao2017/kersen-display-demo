import Link from 'next/link'
import React from 'react'

export default function NotFound() {
  return (
    <main className="pwa-container">
      <section className="pwa-empty">
        <span className="pwa-eyebrow">404</span>
        <h1>页面不存在或还未发布</h1>
        <p>请回到页面列表，或者在 Admin 中确认这个 slug 是否已经创建。</p>
        <Link href="/">返回页面列表</Link>
      </section>
    </main>
  )
}
