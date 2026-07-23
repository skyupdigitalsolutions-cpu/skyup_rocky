# Rocky API — Node 20 (matches package.json engines)
FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

COPY src ./src

# Local document storage (used when STORAGE_DRIVER=local); mount a volume in prod.
RUN mkdir -p storage/uploads

EXPOSE 8791
CMD ["node", "src/index.js"]
