FROM node:24-alpine AS base
WORKDIR /app
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
COPY package.json pnpm-workspace.yaml ./
RUN corepack install

FROM base AS dev
CMD ["sh", "-c", "pnpm install && pnpm dev"]
