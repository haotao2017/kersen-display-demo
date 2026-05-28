import type { Block } from 'payload'

export const CTABlock: Block = {
  slug: 'cta',
  labels: { singular: '行动转化 CTA', plural: '行动转化 CTA' },
  admin: {
    group: '转化',
    images: {
      thumbnail: {
        url: '/admin-blocks/cta.svg',
        alt: 'Call to action block preview',
      },
    },
  },
  fields: [
    { name: 'heading', type: 'text', required: true },
    { name: 'description', type: 'textarea' },
    {
      name: 'buttons',
      type: 'array',
      fields: [
        { name: 'label', type: 'text', required: true },
        { name: 'url', type: 'text', required: true },
        {
          name: 'style',
          type: 'select',
          options: [
            { label: 'Primary', value: 'primary' },
            { label: 'Secondary', value: 'secondary' },
          ],
          defaultValue: 'primary',
        },
      ],
    },
  ],
}
