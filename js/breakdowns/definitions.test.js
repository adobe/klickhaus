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
  allBreakdowns, formatAsn, formatDatacenter, formatForwardedHost, withSubstringFilters,
} from './definitions.js';

describe('formatAsn', () => {
  it('dims the ASN number prefix', () => {
    const result = formatAsn('15169 Google LLC');
    assert.include(result, '<span class="dim-prefix">');
    assert.include(result, '15169 ');
    assert.include(result, 'Google LLC');
  });

  it('returns escaped string when no space found', () => {
    const result = formatAsn('15169');
    assert.strictEqual(result, '15169');
  });

  it('escapes HTML in both parts', () => {
    const result = formatAsn('15169 <script>');
    assert.include(result, '&lt;script&gt;');
    assert.notInclude(result, '<script>');
  });
});

describe('formatForwardedHost', () => {
  it('dims the AEM host suffix', () => {
    const result = formatForwardedHost('customer.com, main--site--org.aem.live');
    assert.include(result, 'customer.com');
    assert.include(result, '<span class="dim-prefix">');
    assert.include(result, ', main--site--org.aem.live');
  });

  it('returns escaped string when no comma-space found', () => {
    const result = formatForwardedHost('single-host.com');
    assert.strictEqual(result, 'single-host.com');
  });

  it('escapes HTML in both parts', () => {
    const result = formatForwardedHost('<b>host</b>, cdn.aem.live');
    assert.include(result, '&lt;b&gt;');
    assert.notInclude(result, '<b>');
  });
});

describe('withSubstringFilters', () => {
  const result = withSubstringFilters(allBreakdowns);
  const byId = (id) => result.find((b) => b.id === id);

  it('enables substring filtering on the supported facets', () => {
    for (const id of ['breakdown-hosts', 'breakdown-forwarded-hosts', 'breakdown-user-agents',
      'breakdown-helix-site', 'breakdown-helix-org', 'breakdown-errors',
      'breakdown-content-types', 'breakdown-paths', 'breakdown-surrogate-key']) {
      assert.isTrue(byId(id).substringFilter, id);
    }
  });

  it('searches ASN by its display value', () => {
    const asn = byId('breakdown-asn');
    assert.isTrue(asn.substringFilter);
    assert.strictEqual(asn.searchCol, asn.col);
  });

  it('leaves other facets and the input list untouched', () => {
    assert.isUndefined(byId('breakdown-status').substringFilter);
    assert.isTrue(allBreakdowns.every((b) => !b.substringFilter));
    assert.lengthOf(result, allBreakdowns.length);
  });
});

describe('formatDatacenter', () => {
  it('adds the location as a hover tooltip', () => {
    assert.strictEqual(
      formatDatacenter('FRA'),
      '<span class="dim-tooltip" title="Frankfurt, Germany">FRA</span>',
    );
  });

  it('covers Fastly-only POP codes', () => {
    assert.include(formatDatacenter('QAS'), 'title="Agra, India"');
  });

  it('returns unknown codes unchanged and escaped', () => {
    assert.strictEqual(formatDatacenter('ZZZ'), 'ZZZ');
    assert.strictEqual(formatDatacenter('<b>'), '&lt;b&gt;');
    assert.strictEqual(formatDatacenter('toString'), 'toString');
  });

  it('is used by the Datacenter breakdown', () => {
    const dc = allBreakdowns.find((b) => b.id === 'breakdown-datacenters');
    assert.strictEqual(dc.dimFormatFn, formatDatacenter);
  });
});
