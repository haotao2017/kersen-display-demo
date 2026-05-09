import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'apps/api/prisma/schema.prisma',
  datasource: {
    url: process.env.DATABASE_URL ?? 'postgresql://kersen:kersen_dev_password@localhost:5432/kersen_esl?schema=public',
  },
});
