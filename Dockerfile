FROM node:24-alpine AS base
WORKDIR /app
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack install

# --- Development (hot reload with tsx) ---
FROM base AS dev
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
COPY . .
# pnpm does not forward SIGTERM; tsx does
CMD ["node_modules/.bin/tsx", "watch", "src/index.ts"]

# --- Build ---
FROM base AS build
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

# --- Panel build ---
FROM node:24-alpine AS panel
WORKDIR /app
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
COPY front/package.json front/pnpm-lock.yaml front/pnpm-workspace.yaml ./
RUN corepack install
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
COPY front/ ./
RUN pnpm build

# --- Production ---
FROM base AS prod
ENV NODE_ENV=production
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --prod
COPY --from=build /app/dist ./dist
COPY --from=panel /app/dist ./public
ENV PANEL_DIR=/app/public
RUN mkdir -p /app/data && chown node:node /app/data
USER node
CMD ["node", "dist/index.js"]
