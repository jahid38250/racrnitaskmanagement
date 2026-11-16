FROM node:22-alpine

WORKDIR /app

# Install timezone data and curl for container health checks
RUN apk add --no-cache tzdata curl && \
    cp /usr/share/zoneinfo/Asia/Dhaka /etc/localtime && \
    echo "Asia/Dhaka" > /etc/timezone

ENV TZ=Asia/Dhaka
ENV NODE_ENV=production
ENV PORT=3000

COPY package*.json ./
RUN npm ci --omit=dev=false || npm install

COPY . .

# Build Vite frontend & bundled Express server (dist/server.js)
RUN npm run build

# Ensure persistent runtime directories exist
RUN mkdir -p /app/data /app/backups /app/uploads/attachments

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/api/system/db-status || exit 1

CMD ["node", "dist/server.js"]
