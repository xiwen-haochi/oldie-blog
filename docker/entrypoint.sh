#!/bin/sh
# Seed the writable config volume from the image the first time it starts, so a
# named volume never leaves the blog without its settings file.
set -e

if [ ! -f /app/config/site.config.json ]; then
  cp /app/config.default/site.config.json /app/config/site.config.json
  echo 'seeded config/site.config.json into the volume'
fi

mkdir -p /app/content/posts /app/content/pages /app/public/uploads

exec "$@"
