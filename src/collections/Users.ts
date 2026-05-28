import type { CollectionConfig } from 'payload'

const isAuthenticated = ({ req: { user } }: { req: { user?: unknown } }) => Boolean(user)

export const Users: CollectionConfig = {
  slug: 'users',
  admin: {
    group: 'System',
    useAsTitle: 'email',
    description: '管理可登录后台的操作账号。',
  },
  labels: {
    singular: '用户',
    plural: '用户',
  },
  auth: true,
  access: {
    read: isAuthenticated,
    create: isAuthenticated,
    update: isAuthenticated,
    delete: isAuthenticated,
  },
  fields: [],
}
