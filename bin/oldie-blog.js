#!/usr/bin/env node
/**
 * CLI entry point: `oldie-blog` starts the server, `oldie-blog --help` explains.
 * Everything is also reachable through `pnpm start`.
 */
import { startServer } from '../src/server.js';

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
oldie-blog — a 1990s personal homepage on a modern engine

  oldie-blog [options]

  --port <n>     port to listen on        (default 4173 or $PORT)
  --host <addr>  interface to bind        (default 127.0.0.1)
  --version      print the version
  --help         this text

Environment:
  SITE_URL        canonical base url, e.g. https://your-site.tld
  ADMIN_USER      admin username            (default: admin)
  ADMIN_PASSWORD  admin password            (generates one on first boot)
  SESSION_SECRET  signs session cookies
  NODE_ENV=production  enables caching headers and hides dev banners
`);
  process.exit(0);
}

if (args.includes('--version') || args.includes('-v')) {
  const pkg = JSON.parse(await (await import('node:fs/promises')).readFile(new URL('../package.json', import.meta.url), 'utf8'));
  console.log(pkg.version);
  process.exit(0);
}

const valueOf = (flag) => {
  const i = args.indexOf(flag);
  return i > -1 ? args[i + 1] : undefined;
};

startServer({
  port: Number(valueOf('--port') || process.env.PORT || 4173),
  host: valueOf('--host') || process.env.HOST || '127.0.0.1',
});
