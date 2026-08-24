# Build from the repo ROOT: docker build -f apps/api/Dockerfile .
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/ai-gateway/package.json packages/ai-gateway/
COPY packages/db/package.json packages/db/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @tutor/api...
COPY packages packages
COPY apps/api apps/api
RUN pnpm --filter @tutor/ai-gateway build && pnpm --filter @tutor/db build && pnpm --filter @tutor/api build

FROM node:22-slim
RUN corepack enable
WORKDIR /repo
COPY --from=build /repo /repo
COPY config config
COPY curriculum curriculum
ENV NODE_ENV=production
EXPOSE 4000
CMD ["node", "apps/api/dist/server.js"]
