FROM node:22-slim AS builder

WORKDIR /app

COPY browser/package*.json ./

RUN npm install

COPY browser/server.ts ./
COPY browser/tsconfig.json ./

RUN npm run build

FROM node:22-slim AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

COPY browser/package*.json ./
RUN npm install --omit=dev && npm cache clean --force

RUN npx playwright install --with-deps chromium \
 && apt-get update \
 && apt-get install -y --no-install-recommends curl \
 && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/dist ./dist

ARG BROWSER_WS_PORT=3001
ARG BROWSER_HEALTH_PORT=3002

ENV BROWSER_WS_PORT=${BROWSER_WS_PORT}
ENV BROWSER_HEALTH_PORT=${BROWSER_HEALTH_PORT}

EXPOSE ${BROWSER_WS_PORT} ${BROWSER_HEALTH_PORT}

CMD ["node", "dist/server.js"]
