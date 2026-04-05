FROM node:20-alpine AS builder
RUN apk add --no-cache python3 make g++
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/ packages/shared/
COPY packages/server/ packages/server/
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @agentshow/server build

# Prune to production deps only
RUN pnpm prune --prod

FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache sqlite

# Copy built output + full node_modules tree (pnpm workspace needs root + package level)
COPY --from=builder /app/packages/server/dist ./packages/server/dist
COPY --from=builder /app/packages/server/package.json ./packages/server/
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/shared/package.json ./packages/shared/
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/server/node_modules ./packages/server/node_modules
COPY --from=builder /app/package.json ./

# Copy migrations
COPY packages/server/migrations ./packages/server/migrations

EXPOSE 3000
VOLUME /data
ENV DATABASE_PATH=/data/agentshow.db
CMD ["node", "packages/server/dist/main.js"]
