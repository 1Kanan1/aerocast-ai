FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM node:26-slim
WORKDIR /app
ENV NODE_ENV=production \
    PORT=44100
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 44100
CMD ["node", "--import", "remix/node-tsx", "server.ts"]
