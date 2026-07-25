# ============================================================
# 1. BUILDER — фронтенд, обрабатка аудио
# ============================================================

FROM node:24-slim AS builder

# ffmpeg для process-audio.js
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# копирование package.json, чтобы установить зависимости
COPY package.json package-lock.json ./

# установка зависимостей
RUN npm ci

# копирование проекта
COPY . .

# переменная окружения для Vite
ENV NODE_ENV=production

# запуск обработки аудио и сборки фронтенда
RUN npm run build

# ============================================================
# 2. RUNNER — Production Image
# ============================================================

FROM node:24-slim AS runner

WORKDIR /app

# зависимости
COPY package.json package-lock.json* ./

RUN npm ci --omit=dev

# фронтенд
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public

# сервер
COPY --from=builder /app/src/config ./src/config
COPY --from=builder /app/src/data ./src/data
COPY --from=builder /app/src/lib ./src/lib
COPY --from=builder /app/src/server ./src/server

ENV NODE_ENV=production

# запуск сервера
CMD ["node", "src/server/main.js"]
