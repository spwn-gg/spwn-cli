FROM oven/bun:1 AS builder

WORKDIR /app

# Copy shared package first (dependency)
COPY ../spwn-shared /shared
WORKDIR /shared
RUN bun install && bun run build

# Copy CLI package
WORKDIR /app
COPY package.json package-lock.json* ./
RUN bun install

COPY . .
RUN bun run build

FROM oven/bun:1-slim

WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/bin ./bin

ENTRYPOINT ["bun", "run", "bin/run.js"]
