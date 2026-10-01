#!/usr/bin/env node
/*
 * Copyright 2026 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

/**
 * Generates js/datacenter-names.js, mapping CDN datacenter (POP) codes to locations
 * for the Datacenter facet tooltip.
 *
 * Sources:
 *  - Cloudflare PoPs: cloudflarestatus.com components ("City, Country - (CODE)")
 *  - Fastly POPs: Fastly's public POP list (city + coordinates; includes Fastly-only
 *    codes such as QAS that are not airports)
 *  - OurAirports (public domain): country for Fastly POPs, via the IATA code or the
 *    nearest airport to the POP coordinates
 *
 * Usage: node scripts/generate-datacenter-names.mjs
 */
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const CLOUDFLARE_URL = 'https://www.cloudflarestatus.com/api/v2/components.json';
const FASTLY_URL = 'https://www.fastly.com/documentation/guides/getting-started/concepts/using-fastlys-global-pop-network/';
const AIRPORTS_URL = 'https://davidmegginson.github.io/ourairports-data/airports.csv';
const COUNTRIES_URL = 'https://davidmegginson.github.io/ourairports-data/countries.csv';
const OUTPUT = fileURLToPath(new URL('../js/datacenter-names.js', import.meta.url));

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) { throw new Error(`${url}: HTTP ${res.status}`); }
  return res.text();
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') {
      field += ch;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...data] = rows;
  return data.map((r) => Object.fromEntries(header.map((h, idx) => [h, r[idx]])));
}

const quote = (s) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

const decodeHtml = (s) => s
  .replace(/<[^>]*>/g, '')
  .replace(/&amp;/g, '&')
  .replace(/&#x27;|&#39;/g, "'")
  .replace(/&quot;/g, '"')
  .replace(/&nbsp;/g, ' ')
  .trim();

async function loadCloudflare() {
  const { components } = JSON.parse(await fetchText(CLOUDFLARE_URL));
  const pops = new Map();
  for (const { name } of components) {
    const m = name.match(/^(.+) - \(([A-Z]{3})\)$/);
    if (m) { pops.set(m[2], m[1].trim()); }
  }
  return pops;
}

async function loadFastly() {
  const html = await fetchText(FASTLY_URL);
  const table = html.match(/<table[\s\S]*?<\/table>/);
  if (!table) { throw new Error('Fastly POP table not found'); }
  const pops = new Map();
  for (const tr of table[0].match(/<tr[\s\S]*?<\/tr>/g).slice(1)) {
    const cells = (tr.match(/<td[\s\S]*?<\/td>/g) || []).map(decodeHtml);
    const [city, code, coords] = cells;
    if (/^[A-Z]{3}$/.test(code || '')) {
      const [lat, lon] = (coords || '').split(',').map(Number);
      pops.set(code, { city, lat, lon });
    }
  }
  return pops;
}

async function loadAirports() {
  const [airports, countries] = await Promise.all([
    fetchText(AIRPORTS_URL).then(parseCsv),
    fetchText(COUNTRIES_URL).then(parseCsv),
  ]);
  const countryNames = new Map(countries.map((c) => [c.code, c.name]));
  const withCountry = airports
    .filter((a) => ['large_airport', 'medium_airport'].includes(a.type))
    .map((a) => ({
      iata: a.iata_code,
      lat: Number(a.latitude_deg),
      lon: Number(a.longitude_deg),
      country: countryNames.get(a.iso_country) || a.iso_country,
    }));
  return {
    byIata: new Map(withCountry.filter((a) => a.iata).map((a) => [a.iata, a])),
    nearest(lat, lon) {
      let best = null;
      let bestDist = Infinity;
      for (const a of withCountry) {
        const dist = (a.lat - lat) ** 2 + ((a.lon - lon) * Math.cos((lat * Math.PI) / 180)) ** 2;
        if (dist < bestDist) {
          best = a;
          bestDist = dist;
        }
      }
      return best;
    },
  };
}

async function main() {
  const [cloudflare, fastly, airports] = await Promise.all([
    loadCloudflare(), loadFastly(), loadAirports(),
  ]);
  console.log(`Cloudflare PoPs: ${cloudflare.size}, Fastly POPs: ${fastly.size}`);

  const names = new Map(cloudflare);
  for (const [code, { city, lat, lon }] of fastly) {
    if (!names.has(code)) {
      const airport = airports.byIata.get(code)
        || (Number.isFinite(lat) && Number.isFinite(lon) ? airports.nearest(lat, lon) : null);
      const country = airport?.country;
      names.set(code, country && country !== city ? `${city}, ${country}` : city);
    }
  }

  const entries = [...names].sort(([a], [b]) => a.localeCompare(b));
  const body = entries.map(([code, name]) => `  ${code}: ${quote(name)},`).join('\n');
  const output = `/*
 * Copyright 2026 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

// Generated by scripts/generate-datacenter-names.mjs — do not edit by hand.
// CDN datacenter (POP) code → location, from Cloudflare's and Fastly's PoP lists.
export const DATACENTER_NAMES = Object.freeze({
${body}
});
`;
  await writeFile(OUTPUT, output);
  console.log(`Wrote ${entries.length} entries to ${OUTPUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
