FROM node:20-alpine AS builder
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/ packages/shared/
COPY packages/server/ packages/server/
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @agentshow/server build

FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache sqlite
COPY --from=builder /app/packages/server/dist ./dist
COPY --from=builder /app/packages/server/package.json ./
COPY --from=builder /app/packages/server/node_modules ./node_modules
COPY --from=builder /app/packages/server/migrations ./migrations
EXPOSE 3000
VOLUME /data
ENV DATABASE_PATH=/data/agentshow.db
CMD ["node", "dist/main.js"]
