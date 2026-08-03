FROM node:20-alpine AS builder

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# --- runtime image: only the standalone server, no dev tooling/source ---
FROM node:20-alpine

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1 \
    NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup -S appgroup && adduser -S appuser -G appgroup
COPY --from=builder --chown=appuser:appgroup /app/.next/standalone ./
USER appuser

EXPOSE 3000

CMD ["node", "server.js"]
