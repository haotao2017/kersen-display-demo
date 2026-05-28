import type { Block } from 'payload'

export const HeroBlock: Block = {
  slug: 'hero',
  labels: { singular: 'Hero 首屏', plural: 'Hero 首屏' },
  admin: {
    group: '页面结构',
    images: {
      thumbnail: {
        url: '/admin-blocks/hero.svg',
        alt: 'Hero block preview',
      },
    },
  },
  fields: [
    { name: 'heading', type: 'text', required: true },
    { name: 'subheading', type: 'text' },
    { name: 'backgroundImage', type: 'upload', relationTo: 'media' },
    { name: 'ctaLabel', type: 'text', label: 'Button Label' },
    { name: 'ctaUrl', type: 'text', label: 'Button URL' },
  ],
}
