FROM node:22-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

FROM dependencies AS build
COPY tsconfig.json ./
COPY tsconfig.web.json ./
COPY src ./src
COPY vite.config.ts ./
COPY web ./web
RUN npm run build

FROM node:22-alpine AS production
ENV NODE_ENV=production
ENV TZ=Europe/London
WORKDIR /app
RUN addgroup -S bot && adduser -S bot -G bot
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/web-dist ./web-dist
COPY drizzle ./drizzle
USER bot
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
