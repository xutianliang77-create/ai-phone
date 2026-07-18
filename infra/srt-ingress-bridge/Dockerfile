FROM node:24-bookworm-slim AS builder

WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
COPY services ./services

RUN npm ci && npm run build -w @translation/srt-ingress-bridge

FROM node:24-bookworm-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates ffmpeg && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /app/services/srt-ingress-bridge/dist ./dist

ENV NODE_ENV=production \
    SRT_INGRESS_FFMPEG_PATH=/usr/bin/ffmpeg

USER node

CMD ["node", "dist/main.js"]
