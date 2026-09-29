# 构建阶段：安装依赖并产出静态文件
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
RUN npm run build

# 运行阶段：nginx 静态托管，完全离线
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
