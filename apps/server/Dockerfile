# Build context: repo root
# docker build -f apps/server/Dockerfile -t bombermp-server .

FROM node:20-alpine AS base
RUN corepack enable

# ─── deps: install all workspace deps (for build tooling) ────────────────────
FROM base AS deps
WORKDIR /app
# Copy every workspace package.json so pnpm can resolve the full graph
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/server/package.json       ./apps/server/
COPY apps/client/package.json       ./apps/client/
RUN pnpm install --frozen-lockfile

# ─── build: compile TypeScript, then create standalone deploy ────────────────
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared/   ./packages/shared/
COPY apps/server/       ./apps/server/
RUN pnpm --filter @bombermp/shared build \
 && pnpm --filter @bombermp/server build \
 && pnpm --filter @bombermp/server deploy --prod --legacy /standalone

# ─── runtime: minimal alpine image ───────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app
COPY --from=build /standalone .
ENV NODE_ENV=production
EXPOSE 3001
CMD ["node", "dist/index.js"]
