# syntax=docker/dockerfile:1

############ deps — install exactly what the lockfile says
FROM node:24-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod

############ runtime — no package manager, no compiler, no dev dependencies
FROM node:24-alpine AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4173
WORKDIR /app

# tini reaps zombies and forwards SIGTERM: stopping the container is a clean stop
RUN apk add --no-cache tini

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY bin ./bin
COPY public ./public
COPY src ./src

# the shipped defaults live read-only; /app/config is a volume on top of it
COPY config/site.config.json ./config.default/site.config.json
COPY content ./.gitkeep ./content

RUN mkdir -p /app/config /app/content/posts /app/content/pages /app/data /app/public/uploads \
    && cp -r /app/config.default /app/config \
    && chown -R node:node /app \
    && chmod +x /app/docker/entrypoint.sh

USER node
VOLUME ["/app/content", "/app/data", "/app/config"]
EXPOSE 4173

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4173)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--", "/app/docker/entrypoint.sh"]
CMD ["node", "src/server.js"]
