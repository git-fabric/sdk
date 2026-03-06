# Build from repo root: docker build -f packages/gateway/Dockerfile .
FROM node:22-slim AS build
WORKDIR /app
COPY tsconfig.base.json ./
COPY packages/gateway/package.json packages/gateway/
COPY packages/gateway/tsconfig.json packages/gateway/
COPY packages/gateway/src packages/gateway/src/
COPY packages/gateway/bin packages/gateway/bin/
WORKDIR /app/packages/gateway
RUN npm install
RUN npx tsc

FROM node:22-slim
WORKDIR /app
COPY --from=build /app/packages/gateway/dist dist/
COPY --from=build /app/packages/gateway/bin bin/
COPY --from=build /app/packages/gateway/node_modules node_modules/
COPY --from=build /app/packages/gateway/package.json ./
ENV PORT=7340 REDIS_URL=redis://redis:6379 LOG_LEVEL=info
EXPOSE 7340
CMD ["node", "dist/index.js"]
