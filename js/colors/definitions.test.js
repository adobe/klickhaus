/*
 * Copyright 2025 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */
import { assert } from 'chai';
import { colorRules } from './definitions.js';

describe('colorRules.status', () => {
  const { getColor } = colorRules.status;

  it('returns ok color for 2xx/3xx', () => {
    assert.strictEqual(getColor('200'), 'var(--status-ok)');
    assert.strictEqual(getColor('301'), 'var(--status-ok)');
    assert.strictEqual(getColor('399'), 'var(--status-ok)');
  });

  it('returns client error for 4xx', () => {
    assert.strictEqual(getColor('404'), 'var(--status-client-error)');
    assert.strictEqual(getColor('429'), 'var(--status-client-error)');
  });

  it('returns server error for 5xx', () => {
    assert.strictEqual(getColor('500'), 'var(--status-server-error)');
    assert.strictEqual(getColor('503'), 'var(--status-server-error)');
  });

  it('returns empty for non-numeric', () => {
    assert.strictEqual(getColor('abc'), '');
  });
});

describe('colorRules.host', () => {
  const { getColor } = colorRules.host;

  it('returns delivery color for .live domains', () => {
    assert.strictEqual(getColor('main--site--org.aem.live'), 'var(--host-delivery)');
  });

  it('returns authoring color for .page domains', () => {
    assert.strictEqual(getColor('main--site--org.aem.page'), 'var(--host-authoring)');
  });

  it('returns customer color for other domains', () => {
    assert.strictEqual(getColor('www.example.com'), 'var(--host-customer)');
  });

  it('handles comma-separated hosts (takes first)', () => {
    assert.strictEqual(getColor('example.com, cdn.aem.live'), 'var(--host-customer)');
  });

  it('returns empty for falsy values', () => {
    assert.strictEqual(getColor(''), '');
    assert.strictEqual(getColor(null), '');
  });
});

describe('colorRules.cacheStatus', () => {
  const { getColor } = colorRules.cacheStatus;

  it('maps HIT variants', () => {
    assert.strictEqual(getColor('HIT'), 'var(--cache-hit)');
    assert.strictEqual(getColor('hit'), 'var(--cache-hit)');
    assert.strictEqual(getColor('HIT-CLUSTER'), 'var(--cache-hit)');
  });

  it('maps MISS variants', () => {
    assert.strictEqual(getColor('MISS'), 'var(--cache-miss)');
    assert.strictEqual(getColor('MISS-CLUSTER'), 'var(--cache-miss)');
  });

  it('maps specific statuses', () => {
    assert.strictEqual(getColor('PASS'), 'var(--cache-pass)');
    assert.strictEqual(getColor('DYNAMIC'), 'var(--cache-dynamic)');
    assert.strictEqual(getColor('REVALIDATED'), 'var(--cache-revalidated)');
    assert.strictEqual(getColor('EXPIRED'), 'var(--cache-expired)');
    assert.strictEqual(getColor('STALE'), 'var(--cache-stale)');
    assert.strictEqual(getColor('ERROR'), 'var(--cache-error)');
    assert.strictEqual(getColor('UNKNOWN'), 'var(--cache-unknown)');
  });

  it('returns empty for unrecognized', () => {
    assert.strictEqual(getColor('FOOBAR'), '');
  });
});

describe('colorRules.method', () => {
  const { getColor } = colorRules.method;

  it('maps HTTP methods', () => {
    assert.strictEqual(getColor('GET'), 'var(--method-get)');
    assert.strictEqual(getColor('POST'), 'var(--method-post)');
    assert.strictEqual(getColor('PUT'), 'var(--method-put)');
    assert.strictEqual(getColor('DELETE'), 'var(--method-delete)');
    assert.strictEqual(getColor('HEAD'), 'var(--method-head)');
    assert.strictEqual(getColor('OPTIONS'), 'var(--method-options)');
    assert.strictEqual(getColor('PATCH'), 'var(--method-patch)');
  });

  it('is case-insensitive', () => {
    assert.strictEqual(getColor('get'), 'var(--method-get)');
    assert.strictEqual(getColor('Post'), 'var(--method-post)');
  });
});

describe('colorRules.contentType', () => {
  const { getColor } = colorRules.contentType;

  it('maps MIME type families', () => {
    assert.strictEqual(getColor('text/html'), 'var(--ct-text)');
    assert.strictEqual(getColor('application/json'), 'var(--ct-application)');
    assert.strictEqual(getColor('image/png'), 'var(--ct-image)');
    assert.strictEqual(getColor('video/mp4'), 'var(--ct-video)');
    assert.strictEqual(getColor('font/woff2'), 'var(--ct-font)');
    assert.strictEqual(getColor('binary/octet-stream'), 'var(--ct-binary)');
  });

  it('returns empty for unknown types', () => {
    assert.strictEqual(getColor('multipart/form-data'), '');
  });
});

describe('colorRules.ip', () => {
  const { getColor } = colorRules.ip;

  it('detects IPv4', () => {
    assert.strictEqual(getColor('192.168.1.1'), 'var(--ip-v4)');
  });

  it('detects IPv6', () => {
    assert.strictEqual(getColor('2001:db8::1'), 'var(--ip-v6)');
  });

  it('detects multi-IP (comma-separated IPv4)', () => {
    assert.strictEqual(getColor('10.0.0.1, 192.168.1.1'), 'var(--ip-v4-multi)');
  });

  it('detects multi-IP IPv6', () => {
    assert.strictEqual(getColor('2001:db8::1, 2001:db8::2'), 'var(--ip-v6-multi)');
  });

  it('returns empty for falsy', () => {
    assert.strictEqual(getColor(''), '');
  });
});

describe('colorRules.userAgent', () => {
  const { getColor } = colorRules.userAgent;

  it('detects good bots', () => {
    assert.strictEqual(getColor('Googlebot/2.1 (+http://www.google.com/bot.html)'), 'var(--ua-good-bot)');
  });

  it('detects bad bots', () => {
    assert.strictEqual(getColor('curl/7.68.0'), 'var(--ua-bad-bot)');
    assert.strictEqual(getColor('python-requests/2.28'), 'var(--ua-bad-bot)');
  });

  it('detects iOS', () => {
    assert.strictEqual(getColor('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)'), 'var(--ua-ios)');
    assert.strictEqual(getColor('Mozilla/5.0 (iPad; CPU OS 17_0)'), 'var(--ua-ios)');
  });

  it('detects Android', () => {
    assert.strictEqual(getColor('Mozilla/5.0 (Linux; Android 14)'), 'var(--ua-android)');
  });

  it('detects Windows', () => {
    assert.strictEqual(getColor('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), 'var(--ua-windows)');
  });

  it('detects macOS', () => {
    assert.strictEqual(getColor('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'), 'var(--ua-mac)');
  });

  it('detects Linux', () => {
    assert.strictEqual(getColor('Mozilla/5.0 (X11; Linux x86_64)'), 'var(--ua-linux)');
  });
});

describe('colorRules.path', () => {
  const { getColor } = colorRules.path;

  it('detects directories', () => {
    assert.strictEqual(getColor('/blog/'), 'var(--path-directory)');
  });

  it('detects scripts', () => {
    assert.strictEqual(getColor('/assets/main.js'), 'var(--path-script)');
    assert.strictEqual(getColor('/style.css'), 'var(--path-script)');
    assert.strictEqual(getColor('/data.json'), 'var(--path-script)');
  });

  it('detects documents', () => {
    assert.strictEqual(getColor('/page.html'), 'var(--path-document)');
    assert.strictEqual(getColor('/report.pdf'), 'var(--path-document)');
  });

  it('detects images', () => {
    assert.strictEqual(getColor('/hero.png'), 'var(--path-image)');
    assert.strictEqual(getColor('/photo.webp'), 'var(--path-image)');
  });

  it('detects media', () => {
    assert.strictEqual(getColor('/video.mp4'), 'var(--path-media)');
    assert.strictEqual(getColor('/audio.mp3'), 'var(--path-media)');
  });

  it('detects fonts', () => {
    assert.strictEqual(getColor('/font.woff2'), 'var(--path-font)');
  });

  it('detects server-side extensions', () => {
    assert.strictEqual(getColor('/page.php'), 'var(--path-server)');
    assert.strictEqual(getColor('/handler.aspx'), 'var(--path-server)');
  });

  it('returns clean for extensionless paths', () => {
    assert.strictEqual(getColor('/about'), 'var(--path-clean)');
  });

  it('strips query strings before matching', () => {
    assert.strictEqual(getColor('/page.html?v=1'), 'var(--path-document)');
  });
});

describe('colorRules.referer', () => {
  const { getColor } = colorRules.referer;

  it('detects Google', () => {
    assert.strictEqual(getColor('https://www.google.com/search?q=test'), 'var(--ref-google)');
  });

  it('detects Adobe', () => {
    assert.strictEqual(getColor('https://www.adobe.com/'), 'var(--ref-adobe)');
    assert.strictEqual(getColor('https://app.adobeaemcloud.com/'), 'var(--ref-adobe)');
  });

  it('detects AEM', () => {
    assert.strictEqual(getColor('https://main--site--org.aem.live/'), 'var(--ref-aem)');
    assert.strictEqual(getColor('https://main--site--org.aem.page/'), 'var(--ref-aem)');
  });

  it('returns other for unknown', () => {
    assert.strictEqual(getColor('https://example.com/'), 'var(--ref-other)');
  });
});

describe('colorRules.error', () => {
  const { getColor } = colorRules.error;

  it('detects redirects', () => {
    assert.strictEqual(getColor('moved'), 'var(--err-redirect)');
  });

  it('detects security errors', () => {
    assert.strictEqual(getColor('not allowed'), 'var(--err-security)');
    assert.strictEqual(getColor('illegal access'), 'var(--err-security)');
  });

  it('detects content bus errors', () => {
    assert.strictEqual(getColor('content-bus: not found'), 'var(--err-contentbus)');
    assert.strictEqual(getColor('failed to load resource'), 'var(--err-contentbus)');
  });

  it('detects storage errors', () => {
    assert.strictEqual(getColor('s3: timeout'), 'var(--err-storage)');
    assert.strictEqual(getColor('r2: not found'), 'var(--err-storage)');
  });

  it('prioritizes security over storage when both match', () => {
    // "s3: access denied" contains "access" -> security wins over "s3:"
    assert.strictEqual(getColor('s3: access denied'), 'var(--err-security)');
  });

  it('returns other for unrecognized', () => {
    assert.strictEqual(getColor('timeout'), 'var(--err-other)');
  });
});

describe('colorRules.cacheControl', () => {
  const { getColor } = colorRules.cacheControl;

  it('detects no-store', () => {
    assert.strictEqual(getColor('no-store'), 'var(--cc-no-store)');
  });

  it('detects no-cache', () => {
    assert.strictEqual(getColor('no-cache'), 'var(--cc-no-cache)');
    assert.strictEqual(getColor('max-age=0'), 'var(--cc-no-cache)');
  });

  it('detects max-age', () => {
    assert.strictEqual(getColor('max-age=3600'), 'var(--cc-max-age)');
  });

  it('returns other for unrecognized', () => {
    assert.strictEqual(getColor('public'), 'var(--cc-other)');
  });
});

describe('colorRules.location', () => {
  const { getColor } = colorRules.location;

  it('detects absolute URLs', () => {
    assert.strictEqual(getColor('https://example.com/page'), 'var(--loc-absolute)');
    assert.strictEqual(getColor('http://example.com/page'), 'var(--loc-absolute)');
  });

  it('detects relative URLs', () => {
    assert.strictEqual(getColor('/new-page'), 'var(--loc-relative)');
    assert.strictEqual(getColor('other-page'), 'var(--loc-relative)');
  });
});

describe('colorRules.acceptEncoding', () => {
  const { getColor } = colorRules.acceptEncoding;

  it('detects brotli', () => {
    assert.strictEqual(getColor('gzip, deflate, br'), 'var(--enc-br)');
  });

  it('detects zstd', () => {
    assert.strictEqual(getColor('zstd, gzip'), 'var(--enc-zstd)');
  });

  it('detects gzip-only', () => {
    assert.strictEqual(getColor('gzip'), 'var(--enc-gzip)');
  });

  it('detects identity', () => {
    assert.strictEqual(getColor('identity'), 'var(--enc-identity)');
  });
});

describe('colorRules.byoCdn', () => {
  const { getColor } = colorRules.byoCdn;

  it('detects CDN providers', () => {
    assert.strictEqual(getColor('fastly'), 'var(--cdn-fastly)');
    assert.strictEqual(getColor('akamai'), 'var(--cdn-akamai)');
    assert.strictEqual(getColor('cloudfront'), 'var(--cdn-cloudfront)');
  });

  it('returns other for unknown CDN', () => {
    assert.strictEqual(getColor('bunny'), 'var(--cdn-other)');
  });
});
