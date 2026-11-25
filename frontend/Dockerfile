FROM oven/bun:1-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile --production && \
    find /app/node_modules -type f \( -name '*.d.ts' -o -name '*.map' -o -name '*.md' \) -delete

FROM node:26.13.0-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PORT=44100
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node app ./app
COPY --chown=node:node public ./public
# tsconfig.json is needed at runtime so remix/node-tsx picks up jsxImportSource.
COPY --chown=node:node server.ts package.json tsconfig.json ./
USER node
EXPOSE 44100
CMD ["node", "--import", "remix/node-tsx", "server.ts"]
