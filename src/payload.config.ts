import { buildConfig } from 'payload'
import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import sharp from 'sharp'
import path from 'path'
import { fileURLToPath } from 'url'
import { Users } from './collections/Users'
import { Media } from './collections/Media'
import { Pages } from './collections/Pages'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

const payloadSecret = process.env.PAYLOAD_SECRET
if (!payloadSecret) {
  throw new Error('PAYLOAD_SECRET is required. Copy .env.example to .env and set a strong secret.')
}

// Use PostgreSQL on Railway (DATABASE_URL set automatically by Railway),
// fall back to local SQLite for development.
const databaseUrl = process.env.DATABASE_URL || process.env.DATABASE_URI

const db = databaseUrl?.startsWith('postgresql') || databaseUrl?.startsWith('postgres')
  ? postgresAdapter({ pool: { connectionString: databaseUrl } })
  : sqliteAdapter({
      client: {
        url: databaseUrl || `file:${path.resolve(dirname, '../payload.db')}`,
      },
    })

export default buildConfig({
  // On a fresh PostgreSQL deployment (INIT_DB_SCHEMA=true), auto-push the
  // Drizzle schema so all tables are created before the first request.
  // pushDevSchema is normally gated to NODE_ENV !== 'production'; calling it
  // here in onInit bypasses that restriction safely.
  onInit: async (payload) => {
    if (process.env.INIT_DB_SCHEMA === 'true' && databaseUrl?.startsWith('postgres')) {
      payload.logger.info('INIT_DB_SCHEMA: pushing Drizzle schema to database...')
      try {
        const { pushDevSchema } = await import('@payloadcms/drizzle')
        await pushDevSchema(payload.db as Parameters<typeof pushDevSchema>[0])
        payload.logger.info('INIT_DB_SCHEMA: schema push complete.')
      } catch (err: unknown) {
        payload.logger.error({ err }, 'INIT_DB_SCHEMA: schema push failed — continuing anyway')
      }
    }
  },
  admin: {
    user: Users.slug,
    importMap: {
      baseDir: path.resolve(dirname),
    },
    components: {
      beforeDashboard: ['@/components/admin/CustomDashboard#default'],
      graphics: {
        Logo: '@/components/admin/Logo#Logo',
        Icon: '@/components/admin/Logo#Icon',
      },
    },
  },
  collections: [Users, Media, Pages],
  editor: lexicalEditor(),
  secret: payloadSecret,
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db,
  sharp,
  serverURL: process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000',
})
