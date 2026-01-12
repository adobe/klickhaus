// Facet command palette for quick navigation (VS Code-style)
import { setFocusedFacet } from './keyboard.js';

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

    // Combine all searchable terms
    const searchTerms = [
      title.toLowerCase(),
      id.replace('breakdown-', '').replace(/-/g, ' ').toLowerCase(),
      dataAlias.toLowerCase(),
      ...aliases.map(a => a.toLowerCase())
    ].filter(Boolean);

    return {
      id,
      title,
      searchTerms,
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
    return [...visible, ...hidden].map(f => ({ facet: f, match: null }));
  }

  const results = [];
  for (const facet of facets) {
    let bestMatch = null;

    for (const term of facet.searchTerms) {
      const match = fuzzyMatch(query, term);
      if (match && (!bestMatch || match.score > bestMatch.score)) {
        bestMatch = { ...match, term };
      }
    }

    if (bestMatch) {
      results.push({ facet, match: bestMatch });
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
    const { facet } = r;
    const isSelected = i === paletteState.selectedIndex;
    const hiddenBadge = facet.isHidden ? '<span class="palette-hidden-badge">hidden</span>' : '';

    return `
      <div class="palette-item${isSelected ? ' selected' : ''}" data-index="${i}" data-facet-id="${facet.id}">
        <span class="palette-item-title">${facet.title}</span>
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
function navigateToFacet(facetId) {
  const facet = document.getElementById(facetId);
  if (!facet) return;

  closeFacetPalette();

  // Update keyboard navigation state to focus this facet
  setFocusedFacet(facetId);

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
        navigateToFacet(results[paletteState.selectedIndex].facet.id);
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
    const facetId = item.dataset.facetId;
    navigateToFacet(facetId);
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
