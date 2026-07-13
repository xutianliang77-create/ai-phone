FROM node:24-bookworm-slim

WORKDIR /app

RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates && \
    rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
COPY services/api-server ./services/api-server
COPY services/realtime-gateway ./services/realtime-gateway
COPY services/translation-worker ./services/translation-worker
COPY services/pstn-bridge ./services/pstn-bridge

RUN npm ci && \
    npm run build -w @translation/contracts && \
    npm run build -w @translation/llm && \
    npm run build -w @translation/api-server && \
    npm run build -w @translation/realtime-gateway && \
    npm run build -w @translation/translation-worker && \
    npm run build -w @translation/pstn-bridge

ENV NODE_ENV=production \
    SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt

USER node

CMD ["node", "services/api-server/dist/main.js"]
