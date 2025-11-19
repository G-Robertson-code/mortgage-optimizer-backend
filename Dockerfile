FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
  libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libgbm1 libasound2 \
  libxss1 libxshmfence1 libgtk-3-0 ca-certificates fonts-liberation libdrm2 \
  libx11-6 libxcomposite1 libxdamage1 libxext6 libxfixes3 libxrandr2 \
  libglu1 libpangocairo-1.0-0 && rm -rf /var/lib/apt/lists/*
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=false
ENV PUPPETEER_CACHE_DIR=/usr/src/app/.cache/puppeteer
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm ci --omit=dev || npm install --legacy-peer-deps
COPY . .
EXPOSE 8080
CMD ["npm","start"]
