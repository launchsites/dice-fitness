FROM node:22-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

FROM dependencies AS build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS production
ENV NODE_ENV=production
ENV TZ=Europe/London
WORKDIR /app
RUN addgroup -S bot && adduser -S bot -G bot
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY drizzle ./drizzle
USER bot
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "process.kill(1, 0)"
CMD ["node", "dist/index.js"]
