# ---- Build ----
FROM node:24-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---- Run ----
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production

# Serveur autonome Next.js (inclut les node_modules nécessaires)
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# La base SQLite vit dans /app/data (monté en volume)
RUN mkdir -p data && chown -R node:node /app
USER node

EXPOSE 3000
CMD ["node", "server.js"]
