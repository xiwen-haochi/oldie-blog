/**
 * A small, correct ZIP writer/reader (store + deflate) with no dependency.
 * Node has zlib; the container format is ~80 lines. Archives come out
 * readable by `unzip`, Finder, Explorer and every other zip tool.
 */
import zlib from 'node:zlib';

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const MAX_ENTRY_BYTES = 512 * 1024 * 1024;

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

export function crc32(buffer) {
  let c = -1;
  for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function dosTime(date) {
  const d = date instanceof Date ? date : new Date(date || Date.now());
  const time = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() / 2) & 31);
  const day = (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);
  return { time, date: day };
}

/**
 * @param {{name: string, data: Buffer|string, mtime?: Date}[]} entries
 * @returns {Buffer}
 */
export function createZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(String(entry.name).replace(/\\/g, '/'), 'utf8');
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data), 'utf8');
    const deflated = zlib.deflateRawSync(raw, { level: 9 });
    const useDeflate = deflated.length < raw.length;
    const body = useDeflate ? deflated : raw;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(raw);
    const { time, date } = dosTime(entry.mtime);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_SIG, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);   // utf-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_SIG, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    // external attributes: unix mode 0644 in the high 16 bits.
    // `<<` would overflow into a negative int32, so shift unsigned.
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + body.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIG, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralBuf, eocd]);
}

/**
 * Read a zip produced by anything (this writer, `zip`, Finder, 7-Zip …).
 * @param {Buffer} buffer
 * @returns {{name: string, data: Buffer, mtime: Date}[]}
 */
export function readZip(buffer) {
  if (!Buffer.isBuffer(buffer)) throw new Error('不是有效的压缩包');

  // locate the end-of-central-directory record, scanning back over the comment
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0 && i > buffer.length - 22 - 0xffff; i--) {
    if (buffer.readUInt32LE(i) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('这不是一个 zip 文件（找不到结尾标记）');

  const total = buffer.readUInt16LE(eocd + 10);
  let pointer = buffer.readUInt32LE(eocd + 16);
  const out = [];

  for (let i = 0; i < total; i++) {
    if (buffer.readUInt32LE(pointer) !== CENTRAL_SIG) throw new Error('中央目录损坏');
    const method = buffer.readUInt16LE(pointer + 10);
    const time = buffer.readUInt16LE(pointer + 12);
    const date = buffer.readUInt16LE(pointer + 14);
    const csize = buffer.readUInt32LE(pointer + 20);
    const usize = buffer.readUInt32LE(pointer + 24);
    const nameLen = buffer.readUInt16LE(pointer + 28);
    const extraLen = buffer.readUInt16LE(pointer + 30);
    const commentLen = buffer.readUInt16LE(pointer + 32);
    const localOffset = buffer.readUInt32LE(pointer + 42);
    const name = buffer.toString('utf8', pointer + 46, pointer + 46 + nameLen);

    if (buffer.readUInt32LE(localOffset) !== LOCAL_SIG) throw new Error('本地文件头损坏: ' + name);
    const lNameLen = buffer.readUInt16LE(localOffset + 26);
    const lExtraLen = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    const slice = buffer.subarray(dataStart, dataStart + csize);

    if (usize > MAX_ENTRY_BYTES) throw new Error('文件太大: ' + name);
    const data = method === 8 ? zlib.inflateRawSync(slice) : Buffer.from(slice);

    out.push({
      name,
      data,
      mtime: dosToDate(date, time),
    });

    pointer += 46 + nameLen + extraLen + commentLen;
  }

  return out;
}

function dosToDate(date, time) {
  const d = new Date(Date.UTC(1980 + ((date >> 9) & 0x7f), ((date >> 5) & 0x0f) - 1, date & 0x1f));
  d.setUTCHours((time >> 11) & 0x1f, (time >> 5) & 0x3f, (time & 0x1f) * 2);
  return d;
}

/** Reject anything that would escape the extraction directory (zip slip). */
export function safeEntryPath(name) {
  const clean = String(name).replace(/\\/g, '/').replace(/^\/+/, '');
  if (clean.split('/').some((part) => part === '..')) {
    throw new Error('压缩包里包含不安全的路径: ' + name);
  }
  return clean;
}
