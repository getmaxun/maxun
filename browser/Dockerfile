FROM mcr.microsoft.com/playwright:v1.57.0-jammy

WORKDIR /app

# Copy package files
COPY browser/package*.json ./

# Install dependencies
RUN npm ci

# Copy TypeScript source and config
COPY browser/server.ts ./
COPY browser/tsconfig.json ./

# Build TypeScript
RUN npm run build

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
