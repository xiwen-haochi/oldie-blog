import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Project root (…/oldie-blog) */
export const ROOT = path.resolve(here, '..', '..');
export const CONFIG_DIR = path.join(ROOT, 'config');
export const CONTENT_DIR = path.join(ROOT, 'content');
export const POSTS_DIR = path.join(CONTENT_DIR, 'posts');
export const PAGES_DIR = path.join(CONTENT_DIR, 'pages');
export const DATA_DIR = path.join(ROOT, 'data');
export const VIEWS_DIR = path.join(ROOT, 'src', 'views');
export const PUBLIC_DIR = path.join(ROOT, 'public');
export const UPLOAD_DIR = path.join(PUBLIC_DIR, 'uploads');
export const ASSET_DIR = path.join(PUBLIC_DIR, 'assets');
