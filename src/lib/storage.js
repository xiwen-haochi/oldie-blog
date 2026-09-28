/**
 * Attachment storage with two drivers:
 *
 *   local — files under public/uploads (the default, works everywhere)
 *   s3    — any S3-compatible store: AWS S3, Cloudflare R2, MinIO, 阿里云 OSS,
 *           腾讯云 COS … all speak the same API, so one tiny SigV4 signer is
 *           enough and we keep the dependency count at zero.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { ROOT } from './paths.js';

const IMAGE_TYPES = /^image\/(png|jpeg|jpg|gif|webp|avif|svg\+xml|bmp|x-icon)$/i;

export function maxBytes(config) {
  return Math.round((config.storage?.maxSizeMb || 4) * 1024 * 1024);
}

export function isAllowedType(type) {
  return IMAGE_TYPES.test(String(type || ''));
}

const safeName = (name) =>
  slugifyName(name).replace(/[^a-z0-9._-]/gi, '-').slice(0, 80);

function slugifyName(input) {
  return String(input || 'file')
    .replace(/\.[^.]+$/, '')
    .replace(/['"]/g, '')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'file';
}

export function extFor(type, fallback = 'bin') {
  const map = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/avif': 'avif',
    'image/svg+xml': 'svg',
    'image/bmp': 'bmp',
    'image/x-icon': 'ico',
  };
  return map[String(type).toLowerCase()] || fallback;
}

export function driverName(config) {
  return String(config.storage?.driver || 'local').toLowerCase() === 's3' ? 's3' : 'local';
}

/* ------------------------------------------------------------------ local */

function localDir(config) {
  return path.resolve(ROOT, config.storage?.directory || 'public/uploads');
}

export function localList(config) {
  const dir = localDir(config);
  const base = config.storage?.publicPath || '/uploads';
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  return names
    .filter((n) => !n.startsWith('.'))
    .map((n) => {
      const st = fs.statSync(path.join(dir, n));
      return { name: n, key: n, url: base + '/' + n, size: st.size, mtime: st.mtime, driver: 'local' };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

export async function localPut(config, { buffer, filename, type }) {
  const dir = localDir(config);
  await fsp.mkdir(dir, { recursive: true });
  const ext = extFor(type, path.extname(filename).slice(1) || 'bin');
  const name = safeName(filename) + '-' + Date.now().toString(36) + '.' + ext;
  await fsp.writeFile(path.join(dir, name), buffer);
  const base = config.storage?.publicPath || '/uploads';
  return { name, key: name, url: base + '/' + name, size: buffer.length, driver: 'local' };
}

export async function localDelete(config, name) {
  await fsp.rm(path.join(localDir(config), path.basename(name)), { force: true });
  return true;
}

/* --------------------------------------------------------------------- s3 */

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

function s3Config(config) {
  const s3 = config.storage?.s3 || {};
  if (!s3.bucket) throw new Error('对象存储还没配置：缺少 bucket');
  if (!s3.endpoint) throw new Error('对象存储还没配置：缺少 endpoint');
  if (!s3.accessKeyId || !s3.secretAccessKey) throw new Error('对象存储还没配置：缺少 accessKeyId / secretAccessKey');
  return s3;
}

function s3ObjectUrl(s3, key) {
  const base = (s3.publicUrl || `${String(s3.endpoint).replace(/\/+$/, '')}/${s3.bucket}`).replace(/\/+$/, '');
  return base + '/' + key.split('/').map(encodeURIComponent).join('/');
}

function s3Target(s3, key) {
  const host = String(s3.endpoint).replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const prefix = [s3.bucket, ...String(s3.prefix || '').split('/').filter(Boolean)].join('/');
  const full = prefix + '/' + key;
  if (s3.pathStyle === false && !s3.endpoint.includes('.')) {
    // virtual-hosted style: bucket.endpoint
    const [first, ...rest] = host.split('.');
    return { host: [first + '-' + s3.bucket, ...rest].join('.'), pathname: '/' + [s3.prefix, key].filter(Boolean).join('/') };
  }
  return { host, pathname: '/' + full };
}

/** Minimal AWS Signature Version 4 for a single-shot PUT/DELETE/GET. */
function signRequest({ method, url, headers, payloadHash, s3 }) {
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const region = s3.region || 'us-east-1';
  const service = 's3';
  const target = new URL(url);
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalHeaders = [
    'host:' + target.host,
    'x-amz-content-sha256:' + payloadHash,
    'x-amz-date:' + amzDate,
  ].join('\n') + '\n';
  const canonicalRequest = [
    method,
    target.pathname.split('/').map(encodeURIComponent).join('/'),
    target.searchParams.toString(),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = [dateStamp, region, service, 'aws4_request'].join('/');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n');
  const dateKey = hmac('AWS4' + s3.secretAccessKey, dateStamp);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, service);
  const signingKey = hmac(serviceKey, 'aws4_request');
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  return {
    ...headers,
    'x-amz-date': amzDate,
    'x-amz-content-sha256': payloadHash,
    Authorization: 'AWS4-HMAC-SHA256 Credential=' + s3.accessKeyId + '/' + scope + ', SignedHeaders=' + signedHeaders + ', Signature=' + signature,
  };
}

export async function s3Put(config, { buffer, filename, type }) {
  const s3 = s3Config(config);
  const ext = extFor(type, path.extname(filename).slice(1) || 'bin');
  const key = (s3.prefix ? s3.prefix.replace(/\/+$/, '') + '/' : '') +
    new Date().toISOString().slice(0, 10) + '/' + safeName(filename) + '-' + Date.now().toString(36) + '.' + ext;
  const { pathname } = s3Target(s3, key);
  const url = (String(s3.endpoint).replace(/\/+$/, '') + pathname);
  const payloadHash = sha256(buffer);
  const headers = signRequest({
    method: 'PUT',
    url,
    headers: { 'content-type': type || 'application/octet-stream', 'content-length': String(buffer.length) },
    payloadHash,
    s3,
  });
  const res = await fetch(url, { method: 'PUT', headers, body: buffer });
  if (!res.ok) throw new Error('S3 PUT ' + res.status + ' ' + (await res.text()).slice(0, 200));
  return { name: key.split('/').pop(), key, url: s3ObjectUrl(s3, key), size: buffer.length, driver: 's3' };
}

export async function s3Delete(config, key) {
  const s3 = s3Config(config);
  const { pathname } = s3Target(s3, key);
  const url = String(s3.endpoint).replace(/\/+$/, '') + pathname;
  const headers = signRequest({ method: 'DELETE', url, headers: {}, payloadHash: sha256(''), s3 });
  const res = await fetch(url, { method: 'DELETE', headers });
  if (!res.ok && res.status !== 404) throw new Error('S3 DELETE ' + res.status);
  return true;
}

export async function s3List(config) {
  const s3 = s3Config(config);
  const base = String(s3.endpoint).replace(/\/+$/, '');
  const prefix = [s3.prefix, ''].filter(Boolean).join('/');
  const target = s3Target(s3, '');
  const url = `${base}${target.pathname}?list-type=2&prefix=${encodeURIComponent(prefix)}`;
  const headers = signRequest({ method: 'GET', url, headers: {}, payloadHash: sha256(''), s3 });
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error('S3 LIST ' + res.status);
  const xml = await res.text();
  const items = [];
  for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
    const key = (m[1].match(/<Key>([\s\S]*?)<\/Key>/) || [])[1] || '';
    const size = Number((m[1].match(/<Size>(\d+)<\/Size>/) || [])[1] || 0);
    const lm = (m[1].match(/<LastModified>([\s\S]*?)<\/LastModified>/) || [])[1] || '';
    if (!key) continue;
    items.push({
      name: key.split('/').pop(),
      key,
      url: s3ObjectUrl(s3, decodeURIComponent(key)),
      size,
      mtime: lm ? new Date(lm) : new Date(0),
      driver: 's3',
    });
  }
  return items.sort((a, b) => b.mtime - a.mtime);
}

/* --------------------------------------------------------------- facade */

export async function listFiles(config) {
  if (driverName(config) === 's3') {
    try { return await s3List(config); } catch (err) { console.error('[storage] list failed:', err.message); return []; }
  }
  return localList(config);
}

export async function putFile(config, { buffer, filename, type }) {
  if (driverName(config) === 's3') return s3Put(config, { buffer, filename, type });
  return localPut(config, { buffer, filename, type });
}

export async function deleteFile(config, file) {
  const name = typeof file === 'string' ? file : file?.name;
  if (driverName(config) === 's3') {
    const key = typeof file === 'string' ? file : file?.key;
    return s3Delete(config, key || name);
  }
  return localDelete(config, name);
}

/** Validate before we spend bandwidth: size, type, config sanity. */
export function checkUpload(config, { size, type }) {
  const limit = maxBytes(config);
  if (size > limit) return '文件太大：' + mb(size) + '（上限 ' + mb(limit) + '）';
  if (!isAllowedType(type)) return '只接受图片：' + (type || '未知类型');
  if (driverName(config) === 's3') {
    const s3 = config.storage?.s3 || {};
    const missing = [];
    if (!s3.bucket) missing.push('bucket');
    if (!s3.endpoint) missing.push('endpoint');
    if (!s3.accessKeyId) missing.push('accessKeyId');
    if (!s3.secretAccessKey) missing.push('secretAccessKey');
    if (missing.length) return '对象存储未配置：缺少 ' + missing.join(' / ');
  }
  return null;
}

export function describeStorage(config) {
  if (driverName(config) !== 's3') {
    return { driver: 'local', label: '本地目录', detail: config.storage?.directory || 'public/uploads' };
  }
  const s3 = config.storage?.s3 || {};
  return {
    driver: 's3',
    label: '对象存储 (S3 兼容)',
    detail: (s3.bucket || '(未设置 bucket)') + ' @ ' + (s3.endpoint || '(未设置 endpoint)'),
  };
}

const mb = (bytes) => Math.round((bytes / 1048576) * 10) / 10 + ' MB';
