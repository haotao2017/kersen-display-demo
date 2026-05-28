import type { CollectionConfig } from 'payload'
import path from 'path'
import { fileURLToPath } from 'url'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)
const isAuthenticated = ({ req: { user } }: { req: { user?: unknown } }) => Boolean(user)

export const Media: CollectionConfig = {
  slug: 'media',
  admin: {
    group: 'Content',
    useAsTitle: 'alt',
    description: '管理 PWA 页面中使用的图片和媒体素材。',
  },
  labels: {
    singular: '媒体',
    plural: '媒体',
  },
  access: {
    read: () => true,
    create: isAuthenticated,
    update: isAuthenticated,
    delete: isAuthenticated,
  },
  fields: [
    {
      name: 'alt',
      type: 'text',
      required: true,
      label: 'Alt Text',
    },
  ],
  upload: {
    staticDir: path.resolve(dirname, '../../public/media'),
  },
}
