# Build from repo root: docker build -f packages/fabric-aiana/Dockerfile .
FROM node:22-slim AS build
WORKDIR /app

COPY tsconfig.base.json ./

# Client package (workspace dependency)
COPY packages/client/package.json packages/client/
COPY packages/client/tsconfig.json packages/client/
COPY packages/client/src packages/client/src/

# Build client
WORKDIR /app/packages/client
RUN npm install
RUN npx tsc

# AIANA package — link client before install so npm doesn't fetch from registry
COPY packages/fabric-aiana/package.json /app/packages/fabric-aiana/
COPY packages/fabric-aiana/tsconfig.json /app/packages/fabric-aiana/
COPY packages/fabric-aiana/src /app/packages/fabric-aiana/src/

WORKDIR /app/packages/fabric-aiana
# Pre-link workspace dep so npm install skips it
RUN mkdir -p node_modules/@fabric-sdk && \
    ln -s /app/packages/client node_modules/@fabric-sdk/client
# Install remaining deps (openai etc), skip missing workspace dep
RUN npm install --ignore-scripts --legacy-peer-deps 2>&1 || true
# Ensure the link survived npm install
RUN rm -rf node_modules/@fabric-sdk/client && \
    mkdir -p node_modules/@fabric-sdk && \
    ln -s /app/packages/client node_modules/@fabric-sdk/client
RUN npx tsc

# Runtime
FROM node:22-slim
WORKDIR /app
COPY --from=build /app/packages/fabric-aiana/dist dist/
COPY --from=build /app/packages/fabric-aiana/node_modules node_modules/
COPY --from=build /app/packages/fabric-aiana/package.json ./
# Copy built client into node_modules (resolve the symlink)
COPY --from=build /app/packages/client/dist node_modules/@fabric-sdk/client/dist/
COPY --from=build /app/packages/client/package.json node_modules/@fabric-sdk/client/
COPY --from=build /app/packages/client/node_modules node_modules/@fabric-sdk/client/node_modules/

ENV PORT=8100 HOST=0.0.0.0
EXPOSE 8100
CMD ["node", "dist/index.js"]
