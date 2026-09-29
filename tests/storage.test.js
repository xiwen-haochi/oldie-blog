import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

// The S3 driver is hand-rolled SigV4 over fetch, so nothing else in the suite
// ever exercises the URLs it builds. These tests point it at a local listener
// and assert on the requests that actually go out.
import { s3Put, s3List, s3Delete, checkUpload, describeStorage, s3Url, s3ObjectUrl } from '../src/lib/storage.js';

const png = Buffer.from('89504e470d0a1a0a', 'hex');

function fakeS3() {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push(req.method + ' ' + req.url);
    if (req.url.includes('list-type=2')) {
      res.writeHead(200, { 'content-type': 'application/xml' });
      res.end(
        '<?xml version="1.0"?><ListBucketResult><Contents>' +
          '<Key>blog/2026-09-29/shot.png</Key><Size>8</Size>' +
          '<LastModified>2026-09-29T10:47:44.000Z</LastModified>' +
          '</Contents></ListBucketResult>'
      );
      return;
    }
    res.writeHead(200);
    res.end('ok');
  });
  return {
    seen,
    async listen() {
      await new Promise((r) => server.listen(0, '127.0.0.1', r));
      return server.address().port;
    },
    close() {
      return new Promise((r) => server.close(r));
    },
  };
}

const withServer = async (fn) => {
  const s = fakeS3();
  const port = await s.listen();
  try {
    return await fn(s, port);
  } finally {
    await s.close();
  }
};

function config(port, endpoint, extra = {}) {
  return {
    storage: {
      driver: 's3',
      s3: {
        bucket: 'my-bucket',
        endpoint,
        prefix: 'blog',
        region: 'cn-shanghai',
        pathStyle: true,
        accessKeyId: 'AK-test',
        secretAccessKey: 'sk-test',
        ...extra,
      },
    },
  };
}

const DATE = String(new Date().toISOString().slice(0, 10));

test('a bare host endpoint is accepted instead of exploding', async () => {
  // Aliyun/R2 users type "oss-cn-shanghai.aliyuncs.com" without a scheme.
  // The request now resolves to https://…, which this plain-HTTP stub cannot
  // answer — so the proof is the shape of the failure, not a 200.
  await withServer(async (s, port) => {
    const cfg = config(port, '127.0.0.1:' + port);
    await assert.rejects(
      () => s3Put(cfg, { buffer: png, filename: 'shot.png', type: 'image/png' }),
      (err) => {
        assert.notEqual(err.code, 'ERR_INVALID_URL', 'the endpoint was still rejected as a URL');
        assert.match(String(err.cause?.message || err.message), /TLS|ECONNRESET|EPROTO|wrong version/i,
          'expected an https-to-http mismatch, got: ' + (err.cause?.message || err.message));
        return true;
      }
    );
    assert.equal(s.seen.length, 0, 'a TLS handshake must not reach the plaintext server');
  });
});

test('an endpoint with a scheme works the same way', async () => {
  await withServer(async (s, port) => {
    const cfg = config(port, 'http://127.0.0.1:' + port);
    await s3Put(cfg, { buffer: png, filename: 'shot.png', type: 'image/png' });
    assert.match(s.seen[0], /^PUT \/my-bucket\/blog\//, s.seen[0]);
  });
});

test('the prefix lands in the path exactly once', async () => {
  await withServer(async (s, port) => {
    const cfg = config(port, 'http://127.0.0.1:' + port);
    const out = await s3Put(cfg, { buffer: png, filename: 'shot.png', type: 'image/png' });
    assert.ok(!s.seen[0].includes('/blog/blog/'), 'prefix applied twice: ' + s.seen[0]);
    assert.ok(out.url.endsWith(out.key), 'the url must point at the key that was written: ' + out.url);
    assert.equal(out.key, 'blog/' + DATE + '/' + out.name);
  });
});

test('without a prefix the key is just date/name', async () => {
  await withServer(async (s, port) => {
    const cfg = config(port, 'http://127.0.0.1:' + port, { prefix: '' });
    const out = await s3Put(cfg, { buffer: png, filename: 'shot.png', type: 'image/png' });
    assert.equal(s.seen[0], 'PUT /my-bucket/' + DATE + '/' + out.name);
    assert.equal(out.key, DATE + '/' + out.name);
  });
});

test('a prefix with stray slashes is tidied up', async () => {
  await withServer(async (s, port) => {
    const cfg = config(port, 'http://127.0.0.1:' + port, { prefix: '/blog/' });
    const out = await s3Put(cfg, { buffer: png, filename: 'shot.png', type: 'image/png' });
    assert.equal(out.key, 'blog/' + DATE + '/' + out.name);
    assert.ok(!s.seen[0].includes('//'), s.seen[0]);
  });
});

test('listing asks the bucket root for the prefix, not a folder path', async () => {
  await withServer(async (s, port) => {
    const cfg = config(port, 'http://127.0.0.1:' + port);
    const items = await s3List(cfg);
    assert.equal(s.seen.length, 1, s.seen.join(','));
    assert.equal(s.seen[0], 'GET /my-bucket/?list-type=2&prefix=blog%2F');
    assert.equal(items.length, 1);
    assert.equal(items[0].key, 'blog/2026-09-29/shot.png');
    assert.ok(items[0].url.endsWith('/my-bucket/blog/2026-09-29/shot.png'), items[0].url);
  });
});

test('a publicUrl replaces the endpoint in returned links', async () => {
  await withServer(async (s, port) => {
    const cfg = config(port, 'http://127.0.0.1:' + port, { publicUrl: 'https://cdn.example.com/' });
    const out = await s3Put(cfg, { buffer: png, filename: 'shot.png', type: 'image/png' });
    assert.ok(out.url.startsWith('https://cdn.example.com/blog/'), out.url);
    assert.match(s.seen[0], /^PUT \/my-bucket\//, 'the upload itself still goes to the endpoint');
  });
});

test('delete targets the key it is given', async () => {
  await withServer(async (s, port) => {
    const cfg = config(port, 'http://127.0.0.1:' + port);
    await s3Delete(cfg, 'blog/2026-09-29/shot.png');
    assert.equal(s.seen[0], 'DELETE /my-bucket/blog/2026-09-29/shot.png');
  });
});

test('an endpoint that is not a host is rejected with a readable message', async () => {
  await assert.rejects(
    () => s3Put(config(0, 'not a url at all'), { buffer: png, filename: 'a.png', type: 'image/png' }),
    /endpoint/
  );
});

test('checkUpload names every missing credential', () => {
  const msg = checkUpload(
    { storage: { driver: 's3', s3: { bucket: 'b', endpoint: 'e', accessKeyId: '', secretAccessKey: '' } } },
    { size: 10, type: 'image/png' }
  );
  assert.match(msg, /secretAccessKey/);
  assert.equal(checkUpload({ storage: { driver: 'local' } }, { size: 10, type: 'image/png' }), null);
});

test('a provider refusal is reported with the reason it gives', async () => {
  // Aliyun answers SecondLevelDomainForbidden; "S3 PUT 403" alone would leave
  // the operator guessing which setting to change.
  const server = http.createServer((req, res) => {
    res.writeHead(403, { 'content-type': 'application/xml' });
    res.end('<?xml version="1.0" encoding="UTF-8"?><Error><Code>SecondLevelDomainForbidden</Code>' +
      '<Message>Please use virtual hosted style to access.</Message></Error>');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try {
    const cfg = config(port, 'http://127.0.0.1:' + port);
    await assert.rejects(
      () => s3Put(cfg, { buffer: png, filename: 'a.png', type: 'image/png' }),
      /SecondLevelDomainForbidden: Please use virtual hosted style/
    );
    await assert.rejects(() => s3List(cfg), /S3 LIST 403 — SecondLevelDomainForbidden/);
  } finally {
    server.close();
  }
});

test('describeStorage reports the s3 driver', () => {
  const d = describeStorage(config(0, 'https://oss-cn-shanghai.aliyuncs.com'));
  assert.equal(d.driver, 's3');
  assert.match(d.detail, /oss-cn-shanghai/);
});

/* ---------------------------------------------------- addressing styles */

// Aliyun OSS answers SecondLevelDomainForbidden unless the bucket is in the
// hostname, so the addressing style is not a preference: it is a requirement
// that differs per provider.
const OSS = 'https://oss-cn-shanghai.aliyuncs.com';
const creds = {
  bucket: 'my-bucket', endpoint: OSS, prefix: 'blog',
  region: 'cn-shanghai', accessKeyId: 'k', secretAccessKey: 's',
};

test('path-style keeps the bucket in the path', () => {
  assert.equal(
    s3Url({ ...creds, pathStyle: true }, 'blog/2026-09-29/shot.png'),
    'https://oss-cn-shanghai.aliyuncs.com/my-bucket/blog/2026-09-29/shot.png'
  );
});

test('virtual-hosted puts the bucket in front of the host', () => {
  assert.equal(
    s3Url({ ...creds, pathStyle: false }, 'blog/2026-09-29/shot.png'),
    'https://my-bucket.oss-cn-shanghai.aliyuncs.com/blog/2026-09-29/shot.png'
  );
});

test('virtual-hosted works for any real host, not just dotless ones', () => {
  // the old guard was "!endpoint.includes('.')", so it never fired for AWS,
  // Aliyun or R2 — only for a bare "localhost:9000"
  for (const endpoint of ['https://oss-cn-shanghai.aliyuncs.com', 'https://s3.eu-west-1.amazonaws.com', 'https://x.r2.cloudflarestorage.com']) {
    const url = s3Url({ ...creds, endpoint, pathStyle: false }, 'blog/a.png');
    assert.ok(url.startsWith('https://my-bucket.'), endpoint + ' -> ' + url);
    assert.ok(!url.includes('/my-bucket/'), 'bucket is in the path too: ' + url);
  }
});

test('a port on the endpoint survives virtual-hosted', () => {
  const s3 = { ...creds, endpoint: 'http://127.0.0.1:9000', pathStyle: false };
  assert.equal(s3Url(s3, 'blog/a.png'), 'http://my-bucket.127.0.0.1:9000/blog/a.png');
});

test('a sub-path on the endpoint is kept', () => {
  const s3 = { ...creds, endpoint: 'https://minio.example.com/gw', pathStyle: true };
  assert.equal(s3Url(s3, 'blog/a.png'), 'https://minio.example.com/gw/my-bucket/blog/a.png');
});

test('the public link matches the addressing style', () => {
  assert.equal(
    s3ObjectUrl({ ...creds, pathStyle: false }, 'blog/a.png'),
    'https://my-bucket.oss-cn-shanghai.aliyuncs.com/blog/a.png'
  );
  assert.equal(
    s3ObjectUrl({ ...creds, pathStyle: true }, 'blog/a.png'),
    'https://oss-cn-shanghai.aliyuncs.com/my-bucket/blog/a.png'
  );
});

test('an explicit publicUrl wins over the addressing style', () => {
  assert.equal(
    s3ObjectUrl({ ...creds, pathStyle: false, publicUrl: 'https://cdn.example.com/' }, 'blog/a.png'),
    'https://cdn.example.com/blog/a.png'
  );
});

test('the bucket root is a valid target for listing', () => {
  assert.equal(s3Url({ ...creds, pathStyle: true }, ''), 'https://oss-cn-shanghai.aliyuncs.com/my-bucket');
  assert.equal(s3Url({ ...creds, pathStyle: false }, ''), 'https://my-bucket.oss-cn-shanghai.aliyuncs.com');
});

