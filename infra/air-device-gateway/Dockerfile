FROM node:24-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
COPY services/air-device-gateway ./services/air-device-gateway

RUN npm ci --workspace @translation/air-device-gateway --include-workspace-root && \
    npm run build -w @translation/contracts && \
    npm run build -w @translation/air-device-gateway && \
    npm cache clean --force

FROM node:24-bookworm

WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=build /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=build /app/services/air-device-gateway/package.json ./services/air-device-gateway/package.json
COPY --from=build /app/services/air-device-gateway/dist ./services/air-device-gateway/dist

ENV NODE_ENV=production \
    SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt

USER node

HEALTHCHECK --interval=5s --timeout=3s --retries=20 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.AIR_GATEWAY_PORT||'8780')+'/readyz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "services/air-device-gateway/dist/main.js"]
