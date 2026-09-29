import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { loadConfig } from './lib/config.js';
import { ContentIndex } from './lib/posts.js';
import { buildIndex } from './lib/search.js';
import { Stats } from './lib/stats.js';
import { Community } from './lib/community.js';
import { Sessions } from './lib/sessions.js';
import { ensureAdminCredentials, loadCredentials } from './lib/auth.js';
import { DATA_DIR, ROOT, VIEWS_DIR } from './lib/paths.js';
import { setDataDriver, getDataDriver } from './lib/store.js';
import { migrateJsonToSqlite } from './lib/migrate.js';

/** Everything a request handler might need, created exactly once. */
export function createContext() {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const site = loadConfig();
  setDataDriver(site.dataDriver);
  // a switch to sqlite should never cost anyone their guestbook or hit count
  const migration = migrateJsonToSqlite({ dataDir: DATA_DIR });
  if (migration.migrated.length) {
    console.log('  已把 ' + migration.migrated.map((m) => m.name).join(', ') + ' 从 JSON 迁移到 SQLite（原文件保留为 .migrated-*.json）');
  }
  if (site.dataDriver === 'sqlite' && getDataDriver() !== 'sqlite') {
    console.warn('  ⚠ 这个 Node 没有 node:sqlite，继续使用 JSON 存储');
  }
  site.assetV = assetVersion();
  const index = new ContentIndex({ siteOrigin: site.url });
  const stats = new Stats();
  const community = new Community();
  const sessions = new Sessions({ secret: readOrCreateSecret() });

  ensureAdminCredentials(site);
  const credentials = loadCredentials();

  const ctx = {
    site,
    index,
    stats,
    community,
    sessions,
    credentials,
    searchIndex: buildIndex(index.posts()),
    startedAt: Date.now(),

    /** Rebuild derived state after content or settings changed. */
    refresh({ config = false } = {}) {
      if (config) {
        ctx.site = loadConfig();
        ctx.index.siteOrigin = ctx.site.url;
      }
      ctx.index.reload();
      ctx.searchIndex = buildIndex(ctx.index.posts());
      return ctx;
    },
  };

  // content changes should be visible in dev without a restart
  if (process.env.NODE_ENV !== 'production') {
    ctx.index.watch((filename) => {
      ctx.searchIndex = buildIndex(ctx.index.posts());
      console.log('\x1b[36m[content]\x1b[0m reloaded ' + filename);
    });
  }

  return ctx;
}

/**
 * Cache-bust CSS/JS by mtime so a restart never serves stale assets.
 *
 * admin.js has to be in this list. Leaving it out is how you end up with a
 * page that shows a button the old script knows nothing about: the markup is
 * no-cache so it updates, the script is cached for 30 days so it does not, and
 * clicking the button does nothing at all.
 */
function assetVersion() {
  let h = 0;
  for (const rel of ['public/css/site.css', 'public/js/site.js', 'public/css/admin.css', 'public/js/admin.js']) {
    try {
      const st = fs.statSync(path.join(ROOT, rel));
      h = (h * 31 + Math.round(st.mtimeMs)) % 1000000007;
    } catch {
      h = h * 7 + 1;
    }
  }
  return String(h);
}

function readOrCreateSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const file = path.join(DATA_DIR, 'session-secret.json');
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (parsed.secret) return parsed.secret;
  } catch { /* create below */ }
  const secret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(file, JSON.stringify({ secret, createdAt: new Date().toISOString() }, null, 2));
  try { fs.chmodSync(file, 0o600); } catch { /* best effort */ }
  return secret;
}

export { ROOT, VIEWS_DIR };
