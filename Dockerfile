# Stellairs 生产镜像:构建前端 + 用 tsx 直跑 TS 服务端
FROM node:24-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 8787

CMD ["npx", "tsx", "server/index.ts"]
