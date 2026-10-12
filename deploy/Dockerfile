# สร้าง image สำหรับเครื่องเซิร์ฟเวอร์ (ใช้กับ deploy/docker-compose.yml)
#   target api  = NestJS + Prisma (รัน migration ก่อนเปิดทุกครั้ง)
#   target web  = Caddy เสิร์ฟหน้าเว็บที่ build แล้ว + ส่ง /api ต่อให้ API

FROM node:22-bookworm-slim AS build
# Prisma ต้องใช้ openssl
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
# postinstall ของ API สั่ง prisma generate ต้องมี schema ก่อน npm ci
COPY apps/api/prisma apps/api/prisma
RUN npm ci
COPY packages packages
COPY apps apps
RUN npm run build:shared \
 && npm run build -w @petmore/api \
 && npm run build -w @petmore/web

FROM node:22-bookworm-slim AS api
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production TZ=Asia/Bangkok
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/packages/shared packages/shared
COPY --from=build /app/apps/api/package.json apps/api/
COPY --from=build /app/apps/api/prisma apps/api/prisma
COPY --from=build /app/apps/api/dist apps/api/dist
# seed.ts (สร้างผู้ดูแลคนแรก) import จาก src
COPY --from=build /app/apps/api/src apps/api/src
COPY --from=build /app/apps/api/tsconfig.json apps/api/
WORKDIR /app/apps/api
EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]

FROM caddy:2.10-alpine AS web
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/dist /srv
