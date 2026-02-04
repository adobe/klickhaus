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
import { renderPaletteListHtml } from './templates/facet-palette-list.js';

// Callback to set focused facet (set by keyboard.js to avoid circular dependency)
let onFacetNavigate = null;

export function setOnFacetNavigate(callback) {
  onFacetNavigate = callback;
}

// Map facet IDs to column patterns for color lookup
const FACET_COLUMNS = {
  'breakdown-status-range': 'response.status',
  'breakdown-hosts': 'request.host',
  'breakdown-forwarded-hosts': 'request.headers.x_forwarded_host',
  'breakdown-content-types': 'response.headers.content_type',
  'breakdown-status': 'response.status',
  'breakdown-errors': 'response.headers.x_error',
  'breakdown-cache': 'cdn.cache_status',
  'breakdown-paths': 'request.url',
  'breakdown-referers': 'request.headers.referer',
  'breakdown-user-agents': 'request.headers.user_agent',
  'breakdown-ips': 'client.ip',
  'breakdown-request-type': 'helix.request_type',
  'breakdown-tech-stack': 'helix.backend_type',
  'breakdown-methods': 'request.method',
  'breakdown-datacenters': 'cdn.datacenter',
  'breakdown-asn': 'client.asn',
  'breakdown-accept': 'request.headers.accept',
  'breakdown-accept-encoding': 'request.headers.accept_encoding',
  'breakdown-req-cache-control': 'request.headers.cache_control',
  'breakdown-byo-cdn': 'request.headers.x_byo_cdn_type',
  'breakdown-push-invalidation': 'request.headers.x_push_invalidation',
  'breakdown-content-length': 'response.headers.content_length',
  'breakdown-location': 'response.headers.location',
  'breakdown-time-elapsed': 'cdn.time_elapsed_msec',
};

// Aliases for facets (beyond the h3 title)
const FACET_ALIASES = {
  'breakdown-status-range': ['status', '2xx', '3xx', '4xx', '5xx', 'response'],
  'breakdown-hosts': ['host', 'domain', 'hostname'],
  'breakdown-forwarded-hosts': ['origin', 'x-forwarded-host', 'upstream'],
  'breakdown-content-types': ['content-type', 'mime', 'media type'],
  'breakdown-status': ['http status', 'response code', '200', '404', '500'],
  'breakdown-errors': ['error', 'x-error', 'failure'],
  'breakdown-cache': ['hit', 'miss', 'caching'],
  'breakdown-paths': ['path', 'url', 'uri', 'endpoint'],
  'breakdown-referers': ['referer', 'referrer', 'source'],
  'breakdown-user-agents': ['ua', 'browser', 'bot', 'crawler'],
  'breakdown-ips': ['ip', 'client ip', 'address'],
  'breakdown-request-type': ['type', 'static', 'dynamic', 'pipeline', 'media'],
  'breakdown-tech-stack': ['tech stack', 'backend', 'fastly', 'cloudflare', 'aws', 'workers', 'r2', 'da', 'helix'],
  'breakdown-methods': ['method', 'get', 'post', 'put', 'delete'],
  'breakdown-datacenters': ['datacenter', 'pop', 'edge', 'location'],
  'breakdown-asn': ['autonomous system', 'network', 'isp'],
  'breakdown-accept': ['accept header'],
  'breakdown-accept-encoding': ['encoding', 'gzip', 'br', 'compression'],
  'breakdown-req-cache-control': ['cache header', 'no-cache'],
  'breakdown-byo-cdn': ['byo', 'bring your own', 'akamai', 'cloudfront'],
  'breakdown-push-invalidation': ['purge', 'invalidate'],
  'breakdown-content-length': ['size', 'bytes', 'length'],
  'breakdown-location': ['redirect', '301', '302', 'location header'],
  'breakdown-time-elapsed': ['time', 'duration', 'latency', 'ttfb'],
};

const paletteState = {
  open: false,
  selectedIndex: 0,
  filteredFacets: [],
  savedQueries: null, // Cached saved queries from index.html
  savedQueriesLoading: false,
};

// Extract just the title text from an h3, ignoring child elements like badges
function extractTitleText(h3) {
  if (!h3) return '';
  // Get only direct text nodes, not text from child elements
  let title = '';
  for (const node of h3.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      title += node.textContent;
    }
  }
  return title.trim();
}

// Extract values from a facet's breakdown table
function getFacetValues(card) {
  const rows = card.querySelectorAll('.breakdown-table tr[tabindex]');
  const values = [];
  for (const row of rows) {
    // Skip "(other)" rows
    if (!row.classList.contains('other-row')) {
      const dimCell = row.querySelector('td.dim');
      if (dimCell) {
        // Get the text content, excluding any badges/prefixes
        const text = dimCell.textContent.trim();
        if (text && text !== '(other)') {
          values.push(text.toLowerCase());
        }
      }
    }
  }
  return values;
}

// Get all facets with their searchable text
function getAllFacets() {
  const cards = [...document.querySelectorAll('.breakdown-card')];
  return cards.map((card) => {
    const { id } = card;
    const h3 = card.querySelector('h3');
    const title = extractTitleText(h3);
    const dataAlias = card.dataset.alias || '';
    const aliases = FACET_ALIASES[id] || [];
    const isHidden = card.classList.contains('hidden');

    // Get current values from the facet's breakdown table
    const facetValues = getFacetValues(card);

    // Primary search terms (title, id, aliases) - high priority
    const primaryTerms = [
      title.toLowerCase(),
      id.replace('breakdown-', '').replace(/-/g, ' ').toLowerCase(),
      dataAlias.toLowerCase(),
      ...aliases.map((a) => a.toLowerCase()),
    ].filter(Boolean);

    // Value terms - lower priority, only used for searching
    const valueTerms = facetValues;

    return {
      id,
      title,
      primaryTerms,
      valueTerms,
      isHidden,
      element: card,
    };
  });
}

/**
 * Check for exact or prefix match
 */
function checkExactOrPrefixMatch(query, target) {
  if (query === target) {
    return { score: 1000, positions: [...Array(query.length).keys()] };
  }
  if (target.startsWith(query)) {
    return { score: 500 + query.length * 10, positions: [...Array(query.length).keys()] };
  }
  return null;
}

/**
 * Check for substring match
 */
function checkSubstringMatch(query, target) {
  const substringIdx = target.indexOf(query);
  if (substringIdx === -1) return null;

  const positions = [...Array(query.length).keys()].map((i) => i + substringIdx);
  const atWordStart = substringIdx === 0 || /[\s\-_.]/.test(target[substringIdx - 1]);
  return { score: 300 + (atWordStart ? 100 : 0) + query.length * 5, positions };
}

/**
 * Calculate fuzzy match score from positions
 */
function calculateFuzzyScore(matchPositions, query, target) {
  let score = 0;
  for (let i = 0; i < matchPositions.length; i += 1) {
    const pos = matchPositions[i];
    if (pos === 0) score += 10;
    else if (target[pos - 1] === ' ' || target[pos - 1] === '-') score += 8;
    if (i > 0 && matchPositions[i] === matchPositions[i - 1] + 1) score += 5;
  }
  score += (query.length / target.length) * 50;
  score -= target.length * 0.1;
  return score;
}

// Fuzzy match: check if all query chars appear in order in target
function fuzzyMatch(queryStr, targetStr) {
  const query = queryStr.toLowerCase();
  const target = targetStr.toLowerCase();

  const exactOrPrefix = checkExactOrPrefixMatch(query, target);
  if (exactOrPrefix) return exactOrPrefix;

  const substring = checkSubstringMatch(query, target);
  if (substring) return substring;

  let queryIdx = 0;
  const matchPositions = [];
  for (let i = 0; i < target.length && queryIdx < query.length; i += 1) {
    if (target[i] === query[queryIdx]) {
      matchPositions.push(i);
      queryIdx += 1;
    }
  }

  if (queryIdx !== query.length) return null;

  return { score: calculateFuzzyScore(matchPositions, query, target), positions: matchPositions };
}

/**
 * Parse a single list item into a query object
 */
function parseQueryItem(item, sectionTitle) {
  const link = item.querySelector('a');
  if (!link) return null;

  const href = link.getAttribute('href');
  if (!href || !href.includes('dashboard.html')) return null;

  const titleEl = link.querySelector('.title');
  const descEl = link.querySelector('.description');

  let title = titleEl?.textContent || '';
  const badge = titleEl?.querySelector('.badge');
  if (badge) title = title.replace(badge.textContent, '').trim();

  if (!title) return null;

  const description = descEl?.textContent || '';
  return {
    type: 'query',
    title,
    description,
    section: sectionTitle,
    href,
    searchTerms: [
      title.toLowerCase(), description.toLowerCase(), sectionTitle.toLowerCase(),
    ].filter(Boolean),
  };
}

// Load saved queries from index.html
async function loadSavedQueries() {
  if (paletteState.savedQueries !== null || paletteState.savedQueriesLoading) {
    return paletteState.savedQueries || [];
  }

  paletteState.savedQueriesLoading = true;

  try {
    const response = await fetch('/index.html');
    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');

    const queries = [];
    for (const section of doc.querySelectorAll('.section')) {
      const sectionTitle = section.querySelector('h2')?.textContent || '';
      for (const item of section.querySelectorAll('li:not(.legacy-view)')) {
        const query = parseQueryItem(item, sectionTitle);
        if (query) queries.push(query);
      }
    }

    paletteState.savedQueries = queries;
    paletteState.savedQueriesLoading = false;
    return queries;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('Failed to load saved queries:', err);
    paletteState.savedQueriesLoading = false;
    paletteState.savedQueries = [];
    return [];
  }
}

/**
 * Find best match from a list of terms
 */
function findBestMatch(terms, query) {
  let bestMatch = null;
  let bestTerm = null;
  for (const term of terms) {
    const match = fuzzyMatch(query, term);
    if (match && (!bestMatch || match.score > bestMatch.score)) {
      bestMatch = { ...match, term };
      bestTerm = term;
    }
  }
  return { match: bestMatch, term: bestTerm };
}

/**
 * Search facets and return matching results
 */
function searchFacets(facets, query) {
  const results = [];
  for (const facet of facets) {
    const primary = findBestMatch(facet.primaryTerms, query);
    const value = findBestMatch(facet.valueTerms, query);

    let bestMatch = null;
    let matchedValue = null;

    if (value.match) {
      bestMatch = value.match;
      matchedValue = value.term;
    } else if (primary.match) {
      primary.match.score += 20;
      bestMatch = primary.match;
    }

    if (bestMatch) {
      results.push({
        type: 'facet', facet, match: bestMatch, matchedValue,
      });
    }
  }
  return results;
}

/**
 * Search saved queries and return matching results
 */
function searchSavedQueries(savedQueries, query) {
  const results = [];
  for (const sq of savedQueries) {
    const { match } = findBestMatch(sq.searchTerms, query);
    if (match) {
      match.score -= 5;
      results.push({ type: 'query', query: sq, match });
    }
  }
  return results;
}

// Filter and score facets and saved queries
function filterFacets(query, savedQueries = []) {
  const facets = getAllFacets();

  if (!query.trim()) {
    const visible = facets.filter((f) => !f.isHidden);
    const hidden = facets.filter((f) => f.isHidden);
    const facetResults = [...visible, ...hidden].map((f) => ({
      type: 'facet', facet: f, match: null, matchedValue: null,
    }));
    const queryResults = savedQueries.map((q) => ({ type: 'query', query: q, match: null }));
    return [...facetResults, ...queryResults];
  }

  const results = [...searchFacets(facets, query), ...searchSavedQueries(savedQueries, query)];

  results.sort((a, b) => {
    if (a.match && b.match) {
      const scoreDiff = b.match.score - a.match.score;
      if (scoreDiff !== 0) return scoreDiff;
    }
    if (a.type !== b.type) return a.type === 'facet' ? -1 : 1;
    if (a.type === 'facet' && a.facet.isHidden !== b.facet.isHidden) {
      return a.facet.isHidden ? 1 : -1;
    }
    return 0;
  });

  return results;
}

// Render the filtered list
function renderList(results) {
  const list = document.getElementById('facetPaletteList');
  if (!list) return;

  list.innerHTML = renderPaletteListHtml(results, paletteState.selectedIndex, FACET_COLUMNS);
  paletteState.filteredFacets = results;

  // Scroll selected item into view
  const selectedEl = list.querySelector('.palette-item.selected');
  if (selectedEl) {
    selectedEl.scrollIntoView({ block: 'nearest' });
  }
}

// Open the palette
export async function openFacetPalette() {
  const dialog = document.getElementById('facetPalette');
  if (!dialog) return;

  paletteState.open = true;
  paletteState.selectedIndex = 0;

  const input = document.getElementById('facetPaletteInput');
  input.value = '';

  // Load saved queries (cached after first load)
  const savedQueries = await loadSavedQueries();

  // Initial render with all facets and saved queries
  const results = filterFacets('', savedQueries);
  renderList(results);

  dialog.showModal();
  input.focus();
}

// Close the palette
export function closeFacetPalette() {
  const dialog = document.getElementById('facetPalette');
  if (dialog) {
    dialog.close();
  }
  paletteState.open = false;
}

// Navigate to selected facet
function navigateToFacet(facetId, matchedValue = null) {
  const facet = document.getElementById(facetId);
  if (!facet) return;

  closeFacetPalette();

  // Update keyboard navigation state to focus this facet
  // Pass matchedValue to pre-select that row
  if (onFacetNavigate) {
    onFacetNavigate(facetId, matchedValue);
  }

  // Scroll to the facet
  facet.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Flash highlight effect
  facet.classList.add('palette-jump-highlight');
  setTimeout(() => {
    facet.classList.remove('palette-jump-highlight');
  }, 600);
}

// Handle input changes
function handleInput(e) {
  const query = e.target.value;
  paletteState.selectedIndex = 0;
  const savedQueries = paletteState.savedQueries || [];
  const results = filterFacets(query, savedQueries);
  renderList(results);
}

// Navigate to saved query URL
function navigateToQuery(href) {
  closeFacetPalette();
  window.location.href = href;
}

// Handle keyboard navigation within palette
function handleKeyDown(e) {
  const results = paletteState.filteredFacets;

  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault();
      paletteState.selectedIndex = Math.min(paletteState.selectedIndex + 1, results.length - 1);
      renderList(results);
      break;
    case 'ArrowUp':
      e.preventDefault();
      paletteState.selectedIndex = Math.max(paletteState.selectedIndex - 1, 0);
      renderList(results);
      break;
    case 'Enter':
      e.preventDefault();
      if (results[paletteState.selectedIndex]) {
        const selected = results[paletteState.selectedIndex];
        if (selected.type === 'facet') {
          navigateToFacet(selected.facet.id, selected.matchedValue);
        } else if (selected.type === 'query') {
          navigateToQuery(selected.query.href);
        }
      }
      break;
    case 'Escape':
      e.preventDefault();
      closeFacetPalette();
      break;
    default:
      // No action for other keys
      break;
  }
}

// Handle click on list items
function handleListClick(e) {
  const item = e.target.closest('.palette-item');
  if (item) {
    const index = parseInt(item.dataset.index, 10);
    const result = paletteState.filteredFacets[index];
    if (result) {
      if (result.type === 'facet') {
        navigateToFacet(result.facet.id, result.matchedValue);
      } else if (result.type === 'query') {
        navigateToQuery(result.query.href);
      }
    }
  }
}

// Initialize the palette
export function initFacetPalette() {
  const input = document.getElementById('facetPaletteInput');
  const list = document.getElementById('facetPaletteList');
  const dialog = document.getElementById('facetPalette');

  if (!input || !list || !dialog) {
    // eslint-disable-next-line no-console
    console.warn('Facet palette elements not found');
    return;
  }

  input.addEventListener('input', handleInput);
  input.addEventListener('keydown', handleKeyDown);
  list.addEventListener('click', handleListClick);

  // Close on backdrop click
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) {
      closeFacetPalette();
    }
  });
}

// Check if palette is open
export function isPaletteOpen() {
  return paletteState.open;
}
