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
# Next standalone lit HOSTNAME — que Docker injecte (= id du conteneur) : le
# serveur se lierait alors à l'interface du conteneur uniquement, et le
# healthcheck interne (127.0.0.1) échouerait → conteneur « unhealthy » alors
# même que les logs ont l'air sains. 0.0.0.0 = écoute sur toutes les
# interfaces (la seule porte publique reste le proxy).
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

# Serveur autonome Next.js (inclut les node_modules nécessaires)
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# La base SQLite vit dans /app/data (monté en volume)
RUN mkdir -p data && chown -R node:node /app
USER node

EXPOSE 3000
CMD ["node", "server.js"]
