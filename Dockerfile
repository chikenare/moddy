FROM node:24-alpine AS base
WORKDIR /app
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack install

# --- Desarrollo (hot reload con tsx) ---
FROM base AS dev
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
COPY . .
# pnpm no reenvía SIGTERM; tsx sí
CMD ["node_modules/.bin/tsx", "watch", "src/index.ts"]

# --- Build ---
FROM base AS build
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

# --- Producción ---
FROM base AS prod
ENV NODE_ENV=production
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --prod
COPY --from=build /app/dist ./dist
RUN mkdir -p /app/data && chown node:node /app/data
USER node
CMD ["node", "dist/index.js"]
