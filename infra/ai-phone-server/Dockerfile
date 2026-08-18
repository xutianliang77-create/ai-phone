FROM node:24-bookworm-slim

WORKDIR /app

RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates python3 && \
    rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
COPY services/api-server ./services/api-server
COPY services/realtime-gateway ./services/realtime-gateway
COPY services/translation-worker ./services/translation-worker
COPY services/pstn-bridge ./services/pstn-bridge
COPY services/srt-ingress-bridge ./services/srt-ingress-bridge
COPY services/voice-agent-runtime ./services/voice-agent-runtime
COPY services/air-device-gateway ./services/air-device-gateway
COPY infra/postgres ./infra/postgres
COPY infra/ai-phone-server/app-container-entrypoint.mjs ./infra/ai-phone-server/app-container-entrypoint.mjs

RUN npm ci && \
    test -x node_modules/@ffmpeg-installer/linux-x64/ffmpeg && \
    npm run build -w @translation/contracts && \
    npm run build -w @translation/llm && \
    npm run build -w @translation/platform-security && \
    npm run build -w @translation/speech-quality && \
    npm run build -w @translation/api-server && \
    npm run build -w @translation/realtime-gateway && \
    npm run build -w @translation/translation-worker && \
    npm run build -w @translation/pstn-bridge && \
    npm run build -w @translation/srt-ingress-bridge && \
    npm run build -w @translation/voice-agent-runtime && \
    npm run build -w @translation/air-device-gateway && \
    npm prune --omit=dev && \
    npm cache clean --force

ENV NODE_ENV=production \
    SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt

USER node

CMD ["node", "infra/ai-phone-server/app-container-entrypoint.mjs"]
