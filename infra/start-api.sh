#!/bin/sh
set -eu

if [ "${PRISMA_DB_PUSH_ON_START:-false}" = "true" ] && [ -n "${DATABASE_URL:-}" ]; then
  echo "Running Prisma db push..."
  ./node_modules/.bin/prisma db push --config prisma.config.ts
fi

exec node apps/api/dist/main.js
