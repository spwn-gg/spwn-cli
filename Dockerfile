FROM node:22-slim

RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

WORKDIR /shared
COPY meridian-shared/package*.json ./
COPY meridian-shared/ ./
RUN npm ci && npm run build

WORKDIR /app
COPY meridian-cli/package*.json ./
RUN npm ci
COPY meridian-cli/ .
RUN npm run build

ENTRYPOINT ["node", "dist/index.js"]
