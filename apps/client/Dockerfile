# Build context: repo root
# docker build -f apps/client/Dockerfile \
#   --build-arg VITE_WS_URL=wss://bombermbapi.avinashjha.space \
#   --build-arg VITE_API_URL=https://bombermbapi.avinashjha.space \
#   -t bombermp/client .

FROM node:20-alpine AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/server/package.json       ./apps/server/
COPY apps/client/package.json       ./apps/client/
RUN pnpm install --frozen-lockfile

COPY tsconfig.base.json ./
COPY packages/shared/   ./packages/shared/
COPY apps/client/       ./apps/client/

# Vite bakes these into the bundle at build time
ARG VITE_WS_URL=http://localhost:3001
ARG VITE_API_URL=http://localhost:3001
ENV VITE_WS_URL=$VITE_WS_URL
ENV VITE_API_URL=$VITE_API_URL

RUN pnpm --filter @bombermp/client build

# ─── runtime: nginx serving static bundle ────────────────────────────────────
FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/apps/client/dist /usr/share/nginx/html
COPY docker/nginx/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
