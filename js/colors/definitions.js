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
// Each rule maps column patterns to color determination logic

export const colorRules = {
  status: {
    patterns: ['response.status'],
    getColor: (value) => {
      const code = parseInt(value, 10);
      if (Number.isNaN(code)) return '';
      if (code < 400) return 'var(--status-ok)';
      if (code < 500) return 'var(--status-client-error)';
      return 'var(--status-server-error)';
    },
    // For status columns, extract first digit and multiply by 100
    transform: (value) => {
      const numMatch = String(value).match(/^(\d)/);
      return numMatch ? parseInt(numMatch[1], 10) * 100 : value;
    },
  },

  host: {
    patterns: ['request.host', 'forwarded_host'],
    getColor: (value) => {
      if (!value) return '';
      const firstHost = value.split(',')[0].trim().toLowerCase();
      if (firstHost.endsWith('.live')) return 'var(--host-delivery)';
      if (firstHost.endsWith('.page')) return 'var(--host-authoring)';
      return 'var(--host-customer)';
    },
  },

  contentType: {
    patterns: ['content_type'],
    getColor: (value) => {
      if (!value) return '';
      const ct = value.toLowerCase();
      if (ct.startsWith('text/')) return 'var(--ct-text)';
      if (ct.startsWith('application/')) return 'var(--ct-application)';
      if (ct.startsWith('image/')) return 'var(--ct-image)';
      if (ct.startsWith('video/')) return 'var(--ct-video)';
      if (ct.startsWith('font/')) return 'var(--ct-font)';
      if (ct.startsWith('binary/')) return 'var(--ct-binary)';
      return '';
    },
  },

  cacheStatus: {
    patterns: ['cache_status'],
    getColor: (value) => {
      if (!value) return '';
      const s = value.toUpperCase();
      if (s.startsWith('HIT')) return 'var(--cache-hit)';
      if (s.startsWith('MISS')) return 'var(--cache-miss)';
      if (s === 'PASS') return 'var(--cache-pass)';
      if (s === 'DYNAMIC') return 'var(--cache-dynamic)';
      if (s === 'REVALIDATED') return 'var(--cache-revalidated)';
      if (s === 'EXPIRED') return 'var(--cache-expired)';
      if (s === 'STALE') return 'var(--cache-stale)';
      if (s.startsWith('ERROR')) return 'var(--cache-error)';
      if (s === 'UNKNOWN') return 'var(--cache-unknown)';
      return '';
    },
  },

  requestType: {
    patterns: ['request_type'],
    getColor: (value) => {
      if (!value) return '';
      const REQUEST_TYPE_COLORS = {
        pipeline: 'var(--rt-pipeline)',
        static: 'var(--rt-static)',
        media: 'var(--rt-media)',
        rum: 'var(--rt-rum)',
        html: 'var(--rt-html)',
        json: 'var(--rt-json)',
        md: 'var(--rt-md)',
        robots: 'var(--rt-robots)',
        content: 'var(--rt-content)',
        code: 'var(--rt-code)',
        job: 'var(--rt-job)',
        discover: 'var(--rt-discover)',
        preview: 'var(--rt-preview)',
        status: 'var(--rt-status)',
        sidekick: 'var(--rt-sidekick)',
        'github-bot': 'var(--rt-github-bot)',
        live: 'var(--rt-live)',
        auth: 'var(--rt-auth)',
        admin: 'var(--rt-admin)',
        delivery: 'var(--rt-delivery)',
        config: 'var(--rt-config)',
      };
      return REQUEST_TYPE_COLORS[value.toLowerCase()] || '';
    },
  },

  backendType: {
    patterns: ['backend_type'],
    getColor: (value) => {
      if (!value) return '';
      const BACKEND_TYPE_COLORS = {
        'fastly / aws': 'var(--ts-fastly-aws)',
        'fastly / cloudflare': 'var(--ts-fastly-cloudflare)',
        'fastly / image optimizer': 'var(--ts-fastly-media)',
        'fastly / admin': 'var(--ts-fastly-admin)',
        'fastly / api': 'var(--ts-fastly-api)',
        'fastly / config': 'var(--ts-fastly-config)',
        'fastly / pipeline': 'var(--ts-fastly-pipeline)',
        'fastly / static': 'var(--ts-fastly-static)',
        'fastly / www': 'var(--ts-fastly-www)',
        'fastly / forms': 'var(--ts-fastly-forms)',
        'fastly / other': 'var(--ts-fastly-other)',
        'cloudflare / r2': 'var(--ts-cf-r2)',
        'cloudflare / da': 'var(--ts-cf-da)',
        'cloudflare / helix': 'var(--ts-cf-helix)',
        'cloudflare / workers': 'var(--ts-cf-workers)',
        aws: 'var(--ts-fastly-aws)',
        cloudflare: 'var(--ts-cf-workers)',
        'cloudflare (implied)': 'var(--ts-cf-workers)',
      };
      return BACKEND_TYPE_COLORS[value.toLowerCase()] || '';
    },
  },

  method: {
    patterns: ['request.method'],
    getColor: (value) => {
      if (!value) return '';
      const m = value.toUpperCase();
      if (m === 'GET') return 'var(--method-get)';
      if (m === 'POST') return 'var(--method-post)';
      if (m === 'PUT') return 'var(--method-put)';
      if (m === 'PATCH') return 'var(--method-patch)';
      if (m === 'HEAD') return 'var(--method-head)';
      if (m === 'OPTIONS') return 'var(--method-options)';
      if (m === 'DELETE') return 'var(--method-delete)';
      return '';
    },
  },

  asn: {
    patterns: ['client.asn'],
    getColor: (value) => {
      if (!value) return '';
      const a = String(value).toLowerCase();
      if (a.includes('adobe')) return 'var(--asn-adobe)';
      if (a.includes('fastly') || a.includes('akamai') || a.includes('cloudflare') || a.includes('amazon')) return 'var(--asn-good-cdn)';
      if (a.includes('zscaler') || a.includes('incapsula')) return 'var(--asn-bad-cdn)';
      if (a.includes('microsoft') || a.includes('google')) return 'var(--asn-cloud)';
      return 'var(--asn-other)';
    },
  },

  error: {
    patterns: ['x_error'],
    getColor: (value) => {
      if (!value) return '';
      const e = value.toLowerCase();
      if (e === 'moved') return 'var(--err-redirect)';
      if (e.includes('not allowed') || e.includes('access') || e.includes('illegal') || e.includes('unsupported')) return 'var(--err-security)';
      if (e.includes('content-bus') || e.includes('failed to load')) return 'var(--err-contentbus)';
      if (e.includes('s3:') || e.includes('r2:')) return 'var(--err-storage)';
      return 'var(--err-other)';
    },
  },

  ip: {
    patterns: ['client.ip', 'forwarded_for'],
    getColor: (value) => {
      if (!value) return '';
      const trimmed = value.trim();
      const hasComma = trimmed.includes(',');
      const isIPv4 = /^[\d.]+$/.test(trimmed.replace(/,\s*/g, ''));
      const isIPv6 = /^[a-fA-F0-9:.,\s]+$/.test(trimmed) && trimmed.includes(':');

      if (hasComma) {
        if (isIPv6) return 'var(--ip-v6-multi)';
        if (isIPv4) return 'var(--ip-v4-multi)';
        return 'var(--ip-bad)';
      } else {
        if (isIPv6) return 'var(--ip-v6)';
        if (isIPv4) return 'var(--ip-v4)';
        return 'var(--ip-bad)';
      }
    },
  },

  userAgent: {
    patterns: ['user_agent'],
    getColor: (value) => {
      if (!value) return '';
      const u = value.toLowerCase();
      if (u.includes('+http')) return 'var(--ua-good-bot)';
      if (!u.startsWith('mozilla')) return 'var(--ua-bad-bot)';
      if (u.includes('iphone') || u.includes('ipad')) return 'var(--ua-ios)';
      if (u.includes('android')) return 'var(--ua-android)';
      if (u.includes('windows')) return 'var(--ua-windows)';
      if (u.includes('macintosh') || u.includes('mac os')) return 'var(--ua-mac)';
      if (u.includes('linux')) return 'var(--ua-linux)';
      return '';
    },
  },

  referer: {
    patterns: ['referer'],
    getColor: (value) => {
      if (!value) return '';
      const r = value.toLowerCase();
      if (r.includes('google.com')) return 'var(--ref-google)';
      if (r.includes('adobe.com') || r.includes('adobe.net') || r.includes('adobeaemcloud.com')) return 'var(--ref-adobe)';
      if (r.includes('.live') || r.includes('.page')) return 'var(--ref-aem)';
      return 'var(--ref-other)';
    },
  },

  path: {
    patterns: ['request.url', 'request.path'],
    getColor: (value) => {
      if (!value) return '';
      const cleanPath = value.split('?')[0].toLowerCase();
      if (cleanPath.endsWith('/')) return 'var(--path-directory)';
      const lastSegment = cleanPath.split('/').pop();
      const dotIndex = lastSegment.lastIndexOf('.');
      if (dotIndex === -1 || dotIndex === 0) return 'var(--path-clean)';
      const ext = lastSegment.slice(dotIndex + 1);
      if (['js', 'mjs', 'json', 'css', 'map'].includes(ext)) return 'var(--path-script)';
      if (['html', 'htm', 'pdf', 'txt', 'xml'].includes(ext)) return 'var(--path-document)';
      if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif', 'ico'].includes(ext)) return 'var(--path-image)';
      if (['mp4', 'webm', 'mov', 'mp3', 'wav', 'ogg'].includes(ext)) return 'var(--path-media)';
      if (['woff', 'woff2', 'ttf', 'otf', 'eot'].includes(ext)) return 'var(--path-font)';
      if (['php', 'asp', 'aspx', 'cgi', 'jsp'].includes(ext)) return 'var(--path-server)';
      return '';
    },
  },

  accept: {
    patterns: ['request.headers.accept'],
    getColor: (value) => {
      if (!value) return '';
      const ct = value.toLowerCase();
      // Use same colors as content-type
      if (ct.startsWith('text/')) return 'var(--ct-text)';
      if (ct.startsWith('application/')) return 'var(--ct-application)';
      if (ct.startsWith('image/')) return 'var(--ct-image)';
      if (ct.startsWith('video/')) return 'var(--ct-video)';
      if (ct.startsWith('font/')) return 'var(--ct-font)';
      if (ct === '*/*') return 'var(--ct-binary)';
      return '';
    },
  },

  acceptEncoding: {
    patterns: ['accept_encoding'],
    getColor: (value) => {
      if (!value) return '';
      const enc = value.toLowerCase();
      if (enc.includes('br')) return 'var(--enc-br)';
      if (enc.includes('zstd')) return 'var(--enc-zstd)';
      if (enc.includes('gzip')) return 'var(--enc-gzip)';
      if (enc.includes('deflate')) return 'var(--enc-deflate)';
      if (enc === 'identity' || enc === '*') return 'var(--enc-identity)';
      return '';
    },
  },

  cacheControl: {
    patterns: ['cache_control'],
    getColor: (value) => {
      if (!value) return '';
      const cc = value.toLowerCase();
      if (cc.includes('no-store')) return 'var(--cc-no-store)';
      if (cc.includes('no-cache') || cc.includes('max-age=0')) return 'var(--cc-no-cache)';
      if (cc.includes('max-age')) return 'var(--cc-max-age)';
      return 'var(--cc-other)';
    },
  },

  byoCdn: {
    patterns: ['x_byo_cdn_type'],
    getColor: (value) => {
      if (!value) return '';
      const cdn = value.toLowerCase();
      if (cdn.includes('fastly')) return 'var(--cdn-fastly)';
      if (cdn.includes('akamai')) return 'var(--cdn-akamai)';
      if (cdn.includes('cloudfront')) return 'var(--cdn-cloudfront)';
      return 'var(--cdn-other)';
    },
  },

  location: {
    patterns: ['response.headers.location'],
    getColor: (value) => {
      if (!value) return '';
      // Absolute URLs start with http:// or https://
      if (value.startsWith('http://') || value.startsWith('https://')) {
        return 'var(--loc-absolute)';
      }
      // Relative URLs (start with / or don't have protocol)
      return 'var(--loc-relative)';
    },
  },
};
