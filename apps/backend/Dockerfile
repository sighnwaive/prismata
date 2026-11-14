FROM node:22-alpine

WORKDIR /app

RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/backend/package.json apps/backend/package.json
RUN pnpm install --frozen-lockfile --prod

COPY apps/backend/src apps/backend/src
COPY scripts/migrate.mjs scripts/migrate.mjs
COPY scripts/load-backend-env.mjs scripts/load-backend-env.mjs
COPY db/migrations db/migrations

EXPOSE 8080
CMD ["pnpm", "start"]
