FROM node:20-slim AS builder

WORKDIR /app

# Copy package files
COPY browser/package*.json ./

# Install dependencies
RUN npm install

# Copy TypeScript source and config
COPY browser/server.ts ./
COPY browser/tsconfig.json ./

# Build TypeScript
RUN npm run build

FROM node:20-slim AS runner

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

# Accept build arguments for ports (with defaults)
ARG BROWSER_WS_PORT=3001
ARG BROWSER_HEALTH_PORT=3002

# Set as environment variables
ENV BROWSER_WS_PORT=${BROWSER_WS_PORT}
ENV BROWSER_HEALTH_PORT=${BROWSER_HEALTH_PORT}

# Expose ports dynamically based on build args
EXPOSE ${BROWSER_WS_PORT} ${BROWSER_HEALTH_PORT}

# Start the browser service (run compiled JS)
CMD ["node", "dist/server.js"]
