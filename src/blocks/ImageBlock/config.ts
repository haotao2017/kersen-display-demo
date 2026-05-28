import type { Block } from 'payload'

export const ImageBlock: Block = {
  slug: 'imageGallery',
  labels: { singular: '图片画廊', plural: '图片画廊' },
  admin: {
    group: '媒体',
    images: {
      thumbnail: {
        url: '/admin-blocks/image-gallery.svg',
        alt: 'Image gallery block preview',
      },
    },
  },
  fields: [
    { name: 'caption', type: 'text' },
    {
      name: 'images',
      type: 'array',
      fields: [
        { name: 'image', type: 'upload', relationTo: 'media', required: true },
      ],
    },
  ],
}
