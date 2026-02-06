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
import {
  getColorForColumn,
  getColorIndicatorHtml,
  getStatusColor,
  getHostColor,
  getContentTypeColor,
  getCacheStatusColor,
  getRequestTypeColor,
  getBackendTypeColor,
  getMethodColor,
  getAsnColor,
  getErrorColor,
  getIPColor,
  getUserAgentColor,
  getRefererColor,
  getPathColor,
  getAcceptColor,
  getAcceptEncodingColor,
  getCacheControlColor,
  getByoCdnColor,
  getLocationColor,
} from './index.js';

describe('getColorForColumn', () => {
  it('returns color when col matches pattern', () => {
    assert.strictEqual(
      getColorForColumn('`response.status`', '200'),
      'var(--status-ok)',
    );
    assert.strictEqual(
      getColorForColumn('request.host', 'main--site.aem.live'),
      'var(--host-delivery)',
    );
    assert.strictEqual(
      getColorForColumn('request.method', 'GET'),
      'var(--method-get)',
    );
  });

  it('uses transform when rule has transform (status range)', () => {
    assert.strictEqual(
      getColorForColumn('response.status', '2xx'),
      'var(--status-ok)',
    );
    assert.strictEqual(
      getColorForColumn('response.status', '4xx'),
      'var(--status-client-error)',
    );
    assert.strictEqual(
      getColorForColumn('response.status', '5xx'),
      'var(--status-server-error)',
    );
  });

  it('returns empty for falsy value', () => {
    assert.strictEqual(getColorForColumn('request.host', ''), '');
    assert.strictEqual(getColorForColumn('request.host', null), '');
  });

  it('returns empty for synthetic bucket values', () => {
    assert.strictEqual(getColorForColumn('request.host', '(empty)'), '');
    assert.strictEqual(getColorForColumn('request.host', '(same)'), '');
    assert.strictEqual(getColorForColumn('request.host', '(other)'), '');
  });

  it('returns empty when no pattern matches column', () => {
    assert.strictEqual(getColorForColumn('unknown.column', 'value'), '');
  });

  it('matches column by pattern substring', () => {
    assert.strictEqual(
      getColorForColumn('request.headers.x_forwarded_host', 'cdn.aem.page'),
      'var(--host-authoring)',
    );
  });
});

describe('getColorIndicatorHtml', () => {
  it('returns span with background and color style when color found', () => {
    const html = getColorIndicatorHtml('response.status', '200');
    assert.include(html, '<span');
    assert.include(html, 'status-color');
    assert.include(html, 'var(--status-ok)');
    assert.include(html, 'background:');
    assert.include(html, 'color:');
  });

  it('uses custom className when provided', () => {
    const html = getColorIndicatorHtml('request.host', 'example.aem.live', 'facet-color');
    assert.include(html, 'facet-color');
    assert.include(html, 'var(--host-delivery)');
  });

  it('returns empty string when no color', () => {
    assert.strictEqual(getColorIndicatorHtml('unknown.col', 'x'), '');
    assert.strictEqual(getColorIndicatorHtml('request.host', ''), '');
    assert.strictEqual(getColorIndicatorHtml('request.host', '(empty)'), '');
  });
});

describe('legacy color getters', () => {
  it('getStatusColor returns status color', () => {
    assert.strictEqual(getStatusColor('200'), 'var(--status-ok)');
    assert.strictEqual(getStatusColor('404'), 'var(--status-client-error)');
  });

  it('getHostColor returns host color', () => {
    assert.strictEqual(getHostColor('main.aem.live'), 'var(--host-delivery)');
    assert.strictEqual(getHostColor('main.aem.page'), 'var(--host-authoring)');
  });

  it('getMethodColor returns method color', () => {
    assert.strictEqual(getMethodColor('GET'), 'var(--method-get)');
    assert.strictEqual(getMethodColor('POST'), 'var(--method-post)');
  });

  it('getPathColor returns path color by extension', () => {
    assert.strictEqual(getPathColor('/page.html'), 'var(--path-document)');
    assert.strictEqual(getPathColor('/script.js'), 'var(--path-script)');
  });

  it('getCacheStatusColor returns cache status color', () => {
    assert.strictEqual(getCacheStatusColor('HIT'), 'var(--cache-hit)');
    assert.strictEqual(getCacheStatusColor('MISS'), 'var(--cache-miss)');
  });

  it('getRequestTypeColor returns request type color', () => {
    assert.strictEqual(getRequestTypeColor('pipeline'), 'var(--rt-pipeline)');
    assert.strictEqual(getRequestTypeColor('static'), 'var(--rt-static)');
  });

  it('getLocationColor returns location color', () => {
    assert.strictEqual(getLocationColor('https://example.com'), 'var(--loc-absolute)');
    assert.strictEqual(getLocationColor('/relative'), 'var(--loc-relative)');
  });

  it('getContentTypeColor returns content type color', () => {
    assert.strictEqual(getContentTypeColor('text/html'), 'var(--ct-text)');
    assert.strictEqual(getContentTypeColor('image/png'), 'var(--ct-image)');
  });

  it('getBackendTypeColor returns backend type color', () => {
    assert.strictEqual(getBackendTypeColor('fastly / aws'), 'var(--ts-fastly-aws)');
    assert.strictEqual(getBackendTypeColor('cloudflare / r2'), 'var(--ts-cf-r2)');
  });

  it('getAsnColor returns ASN color', () => {
    assert.strictEqual(getAsnColor('14340 - Adobe Inc.'), 'var(--asn-adobe)');
    assert.strictEqual(getAsnColor('54113 - Fastly'), 'var(--asn-good-cdn)');
  });

  it('getErrorColor returns error color', () => {
    assert.strictEqual(getErrorColor('moved'), 'var(--err-redirect)');
    assert.strictEqual(getErrorColor('not allowed'), 'var(--err-security)');
  });

  it('getIPColor returns IP color', () => {
    assert.strictEqual(getIPColor('192.168.1.1'), 'var(--ip-v4)');
    assert.strictEqual(getIPColor('2001:db8::1'), 'var(--ip-v6)');
  });

  it('getUserAgentColor returns user agent color', () => {
    assert.strictEqual(getUserAgentColor('Mozilla/5.0 (iPhone)'), 'var(--ua-ios)');
    assert.strictEqual(getUserAgentColor('curl/7.0'), 'var(--ua-bad-bot)');
  });

  it('getRefererColor returns referer color', () => {
    assert.strictEqual(getRefererColor('https://www.google.com/'), 'var(--ref-google)');
    assert.strictEqual(getRefererColor('https://example.com/'), 'var(--ref-other)');
  });

  it('getAcceptColor returns accept header color', () => {
    assert.strictEqual(getAcceptColor('text/html'), 'var(--ct-text)');
    assert.strictEqual(getAcceptColor('*/*'), 'var(--ct-binary)');
  });

  it('getAcceptEncodingColor returns encoding color', () => {
    assert.strictEqual(getAcceptEncodingColor('gzip, br'), 'var(--enc-br)');
    assert.strictEqual(getAcceptEncodingColor('gzip'), 'var(--enc-gzip)');
  });

  it('getCacheControlColor returns cache-control color', () => {
    assert.strictEqual(getCacheControlColor('no-store'), 'var(--cc-no-store)');
    assert.strictEqual(getCacheControlColor('max-age=3600'), 'var(--cc-max-age)');
  });

  it('getByoCdnColor returns BYO CDN color', () => {
    assert.strictEqual(getByoCdnColor('fastly'), 'var(--cdn-fastly)');
    assert.strictEqual(getByoCdnColor('cloudfront'), 'var(--cdn-cloudfront)');
  });
});
