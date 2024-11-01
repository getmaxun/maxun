FROM mcr.microsoft.com/playwright:v1.40.0-jammy

# Set working directory
WORKDIR /app

# Install node dependencies
COPY package*.json ./
COPY maxun-core ./maxun-core
COPY src ./src
COPY server ./server
COPY tsconfig.json ./
COPY server/tsconfig.json ./server/
COPY server/start.sh ./  

# Install dependencies
RUN npm install

# Install Playwright browsers and dependencies
RUN npx playwright install --with-deps chromium

# Install xvfb for display support
RUN apt-get update && apt-get install -y xvfb

# Make the script executable
RUN chmod +x ./start.sh

# Expose the backend port
EXPOSE 8080

# Start the backend using the start script
CMD ["./start.sh"]