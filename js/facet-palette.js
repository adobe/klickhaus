// Facet command palette for quick navigation (VS Code-style)
import { setFocusedFacet } from './keyboard.js';
import { getColorForColumn } from './colors/index.js';

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
  'breakdown-backend-type': 'helix.backend_type',
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
  'breakdown-time-elapsed': 'cdn.time_elapsed_msec'
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
  'breakdown-backend-type': ['backend', 'origin type'],
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
  'breakdown-time-elapsed': ['time', 'duration', 'latency', 'ttfb']
};

let paletteState = {
  open: false,
  selectedIndex: 0,
  filteredFacets: []
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
    if (row.classList.contains('other-row')) continue;
    const dimCell = row.querySelector('td.dim');
    if (dimCell) {
      // Get the text content, excluding any badges/prefixes
      const text = dimCell.textContent.trim();
      if (text && text !== '(other)') {
        values.push(text.toLowerCase());
      }
    }
  }
  return values;
}

// Get all facets with their searchable text
function getAllFacets() {
  const cards = [...document.querySelectorAll('.breakdown-card')];
  return cards.map(card => {
    const id = card.id;
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
      ...aliases.map(a => a.toLowerCase())
    ].filter(Boolean);

    // Value terms - lower priority, only used for searching
    const valueTerms = facetValues;

    return {
      id,
      title,
      primaryTerms,
      valueTerms,
      isHidden,
      element: card
    };
  });
}

// Fuzzy match: check if all query chars appear in order in target
function fuzzyMatch(query, target) {
  query = query.toLowerCase();
  target = target.toLowerCase();

  let queryIdx = 0;
  let matchPositions = [];

  for (let i = 0; i < target.length && queryIdx < query.length; i++) {
    if (target[i] === query[queryIdx]) {
      matchPositions.push(i);
      queryIdx++;
    }
  }

  if (queryIdx !== query.length) return null;

  // Score: prefer matches at word starts and consecutive chars
  let score = 0;
  for (let i = 0; i < matchPositions.length; i++) {
    const pos = matchPositions[i];
    // Bonus for match at start
    if (pos === 0) score += 10;
    // Bonus for match after space/hyphen (word start)
    else if (target[pos - 1] === ' ' || target[pos - 1] === '-') score += 8;
    // Bonus for consecutive matches
    if (i > 0 && matchPositions[i] === matchPositions[i - 1] + 1) score += 5;
  }
  // Penalty for longer targets
  score -= target.length * 0.1;

  return { score, positions: matchPositions };
}

// Filter and score facets
function filterFacets(query) {
  const facets = getAllFacets();

  if (!query.trim()) {
    // No query: show all visible facets, then hidden ones
    const visible = facets.filter(f => !f.isHidden);
    const hidden = facets.filter(f => f.isHidden);
    return [...visible, ...hidden].map(f => ({ facet: f, match: null, matchedValue: null }));
  }

  const results = [];
  for (const facet of facets) {
    let bestPrimaryMatch = null;
    let bestValueMatch = null;
    let bestValueTerm = null;

    // Try primary terms (title, aliases)
    for (const term of facet.primaryTerms) {
      const match = fuzzyMatch(query, term);
      if (match && (!bestPrimaryMatch || match.score > bestPrimaryMatch.score)) {
        bestPrimaryMatch = { ...match, term };
      }
    }

    // Try value terms (actual facet values)
    for (const term of facet.valueTerms) {
      const match = fuzzyMatch(query, term);
      if (match && (!bestValueMatch || match.score > bestValueMatch.score)) {
        bestValueMatch = { ...match, term };
        bestValueTerm = term;
      }
    }

    // Decide which match to use:
    // - If we have a value match, prefer it (allows direct filtering)
    // - Otherwise use primary match
    // - Add bonus to primary matches for ranking between facets
    let bestMatch = null;
    let matchedValue = null;

    if (bestValueMatch) {
      bestMatch = bestValueMatch;
      matchedValue = bestValueTerm;
    } else if (bestPrimaryMatch) {
      bestPrimaryMatch.score += 20; // Primary-only match bonus for ranking
      bestMatch = bestPrimaryMatch;
    }

    if (bestMatch) {
      results.push({ facet, match: bestMatch, matchedValue });
    }
  }

  // Sort by score descending, then by visibility
  results.sort((a, b) => {
    if (a.match && b.match) {
      const scoreDiff = b.match.score - a.match.score;
      if (scoreDiff !== 0) return scoreDiff;
    }
    // Prefer visible facets
    if (a.facet.isHidden !== b.facet.isHidden) {
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

  list.innerHTML = results.map((r, i) => {
    const { facet, matchedValue } = r;
    const isSelected = i === paletteState.selectedIndex;
    const hiddenBadge = facet.isHidden ? '<span class="palette-hidden-badge">hidden</span>' : '';

    // When matched by value, show value as main text with facet as badge
    // When matched by facet name, show facet as main text
    const mainText = matchedValue ? escapeHtml(matchedValue) : facet.title;
    const facetBadge = matchedValue ? `<span class="palette-facet-badge">${facet.title}</span>` : '';

    // Get color for value matches
    let colorStyle = '';
    if (matchedValue) {
      const col = FACET_COLUMNS[facet.id];
      if (col) {
        const color = getColorForColumn(col, matchedValue);
        if (color) {
          colorStyle = `style="border-left: 3px solid ${color};"`;
        }
      }
    }

    return `
      <div class="palette-item${isSelected ? ' selected' : ''}${matchedValue ? ' value-match' : ''}" ${colorStyle} data-index="${i}" data-facet-id="${facet.id}">
        <span class="palette-item-title">${mainText}</span>
        ${facetBadge}
        ${hiddenBadge}
      </div>
    `;
  }).join('');

  paletteState.filteredFacets = results;

  // Scroll selected item into view
  const selectedEl = list.querySelector('.palette-item.selected');
  if (selectedEl) {
    selectedEl.scrollIntoView({ block: 'nearest' });
  }
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Open the palette
export function openFacetPalette() {
  const dialog = document.getElementById('facetPalette');
  if (!dialog) return;

  paletteState.open = true;
  paletteState.selectedIndex = 0;

  const input = document.getElementById('facetPaletteInput');
  input.value = '';

  // Initial render with all facets
  const results = filterFacets('');
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
  setFocusedFacet(facetId, matchedValue);

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
  const results = filterFacets(query);
  renderList(results);
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
        navigateToFacet(selected.facet.id, selected.matchedValue);
      }
      break;
    case 'Escape':
      e.preventDefault();
      closeFacetPalette();
      break;
  }
}

// Handle click on list items
function handleListClick(e) {
  const item = e.target.closest('.palette-item');
  if (item) {
    const index = parseInt(item.dataset.index);
    const result = paletteState.filteredFacets[index];
    if (result) {
      navigateToFacet(result.facet.id, result.matchedValue);
    }
  }
}

// Initialize the palette
export function initFacetPalette() {
  const input = document.getElementById('facetPaletteInput');
  const list = document.getElementById('facetPaletteList');
  const dialog = document.getElementById('facetPalette');

  if (!input || !list || !dialog) {
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
