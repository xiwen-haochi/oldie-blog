############ deps — install exactly what the lockfile says
# No `#syntax=` line and no `RUN --mount`: both are BuildKit-only sugar, and
# some hosts validate a Dockerfile with a plain parser that rejects them.
# The cost is a slower rebuild; the image is identical either way.
FROM node:24-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

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
# the operational scripts travel with the image: without them a running
# container has no way to reset a password, add a post, or seed the demo data
COPY scripts ./scripts
COPY docker/entrypoint.sh ./docker/entrypoint.sh

# /app/config and /app/content are volumes. A fresh (empty) volume is seeded
# from exactly what the image ships, which is why the default config has to
# live at the real path rather than in some staging directory.
COPY config/site.config.json ./config/site.config.json
COPY content/.gitkeep ./content/.gitkeep

RUN mkdir -p /app/content/posts /app/content/pages /app/data /app/public/uploads \
    && chown -R node:node /app \
    && chmod +x /app/docker/entrypoint.sh

USER node
EXPOSE 4173

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4173)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--", "/app/docker/entrypoint.sh"]
CMD ["node", "src/server.js"]
