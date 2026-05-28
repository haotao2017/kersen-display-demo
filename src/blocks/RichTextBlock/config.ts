import type { Block } from 'payload'

export const RichTextBlock: Block = {
  slug: 'richText',
  labels: { singular: '富文本内容', plural: '富文本内容' },
  admin: {
    group: '内容',
    images: {
      thumbnail: {
        url: '/admin-blocks/rich-text.svg',
        alt: 'Rich text block preview',
      },
    },
  },
  fields: [
    { name: 'content', type: 'richText', required: true },
  ],
}
