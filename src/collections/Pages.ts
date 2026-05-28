import type { CollectionConfig } from 'payload'
import { HeroBlock } from '../blocks/HeroBlock/config.ts'
import { RichTextBlock } from '../blocks/RichTextBlock/config.ts'
import { ImageBlock } from '../blocks/ImageBlock/config.ts'
import { CTABlock } from '../blocks/CTABlock/config.ts'

const isAuthenticated = ({ req: { user } }: { req: { user?: unknown } }) => Boolean(user)

export const Pages: CollectionConfig = {
  slug: 'pages',
  access: {
    read: () => true,
    create: isAuthenticated,
    update: isAuthenticated,
    delete: isAuthenticated,
  },
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'slug', 'updatedAt'],
    description: '管理前台 PWA 页面内容、URL 和可视化区块。',
    group: 'Content',
    listSearchableFields: ['title', 'slug'],
    preview: (doc) => {
      const serverURL = process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000'
      const slug = typeof doc.slug === 'string' ? doc.slug : ''
      return slug === 'home' ? serverURL : `${serverURL}/${slug}`
    },
  },
  labels: {
    singular: '页面',
    plural: '页面',
  },
  fields: [
    {
      name: 'title',
      type: 'text',
      required: true,
    },
    {
      name: 'slug',
      type: 'text',
      required: true,
      unique: true,
      admin: { description: 'URL path — only lowercase letters, numbers, hyphens (e.g. "home", "about-us")' },
      validate: (value: string | null | undefined) => {
        if (!value) return 'Slug is required'
        if (!/^[a-z0-9-]+$/.test(value)) return 'Slug can only contain lowercase letters, numbers, and hyphens'
        return true
      },
    },
    {
      name: 'layout',
      type: 'blocks',
      blocks: [HeroBlock, RichTextBlock, ImageBlock, CTABlock],
    },
  ],
}
