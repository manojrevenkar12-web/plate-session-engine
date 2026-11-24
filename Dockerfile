# The API image: NestJS on Fastify, one image for every role (all, ingest, engine).
FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY packages/domain/package.json packages/domain/
COPY packages/engine/package.json packages/engine/
COPY packages/store/package.json packages/store/
COPY packages/world/package.json packages/world/
COPY packages/lab/package.json packages/lab/
COPY apps/api/package.json apps/api/
COPY apps/console/package.json apps/console/
RUN pnpm install --frozen-lockfile --filter @pse/api...
COPY config config
COPY packages/domain packages/domain
COPY packages/engine packages/engine
COPY packages/store packages/store
COPY apps/api apps/api
RUN pnpm --filter @pse/store generate

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app /app
USER node
EXPOSE 3000
WORKDIR /app/apps/api
CMD ["node", "--import", "tsx", "src/main.ts"]
