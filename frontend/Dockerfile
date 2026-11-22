FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile --production

FROM node:26.13.0-slim
WORKDIR /app
ENV NODE_ENV=production \
    PORT=44100
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node . .
USER node
EXPOSE 44100
CMD ["node", "--import", "remix/node-tsx", "server.ts"]
