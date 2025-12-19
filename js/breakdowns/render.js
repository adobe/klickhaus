// Breakdown table rendering
import { escapeHtml } from '../utils.js';
import { formatNumber, formatQueryTime } from '../format.js';
import { getColorIndicatorHtml } from '../colors/index.js';
import { state } from '../state.js';

// Get filters for a specific column
export function getFiltersForColumn(col) {
  return state.filters.filter(f => f.col === col);
}

// Get next topN value for "show more" functionality
export function getNextTopN() {
  const options = [5, 10, 20, 50, 100];
  const currentIdx = options.indexOf(state.topN);
  if (currentIdx === -1 || currentIdx >= options.length - 1) return null;
  return options[currentIdx + 1];
}

// Format dimension value with dimmed prefix if applicable
function formatDimWithPrefix(dim, dimPrefixes, dimFormatFn) {
  // Use custom format function if provided
  if (dimFormatFn) return dimFormatFn(dim);
  if (!dimPrefixes || dimPrefixes.length === 0) return escapeHtml(dim);
  for (const prefix of dimPrefixes) {
    if (dim.startsWith(prefix)) {
      return `<span class="dim-prefix">${escapeHtml(prefix)}</span>${escapeHtml(dim.slice(prefix.length))}`;
    }
  }
  return escapeHtml(dim);
}

export function renderBreakdownTable(id, data, totals, col, linkPrefix, linkSuffix, linkFn, elapsed, dimPrefixes, dimFormatFn, summaryRatio, summaryLabel, summaryColor) {
  const card = document.getElementById(id);
  // Store original title in data attribute, or read from h3 if first render
  if (!card.dataset.title) {
    card.dataset.title = card.querySelector('h3').textContent;
  }
  const title = card.dataset.title;

  // Get active filters for this column
  const columnFilters = getFiltersForColumn(col);
  const hasFilters = columnFilters.length > 0;
  const colEscaped = col.replace(/'/g, "\\'");

  // Speed indicator based on elapsed time (aligned with Google LCP thresholds)
  const speedClass = elapsed < 2500 ? 'fast' : (elapsed < 4000 ? 'medium' : 'slow');
  const speedTitle = formatQueryTime(elapsed);
  const speedIndicator = `<span class="speed-indicator ${speedClass}" title="${speedTitle}"></span>`;

  // Summary metric display (e.g., "87% efficiency")
  const summaryColorClass = summaryColor ? ` summary-${summaryColor}` : '';
  const summaryHtml = (summaryRatio !== null && summaryLabel)
    ? `<span class="summary-metric${summaryColorClass}" title="${(summaryRatio * 100).toFixed(1)}% ${summaryLabel}">${Math.round(summaryRatio * 100)}%</span>`
    : '';

  if (data.length === 0) {
    let html = `<h3>${speedIndicator}${title}${summaryHtml}`;
    if (hasFilters) {
      html += ` <button class="clear-facet-btn" onclick="clearFiltersForColumn('${colEscaped}')">Clear</button>`;
    }
    html += `</h3><div class="empty">No data</div>`;
    card.innerHTML = html;
    return;
  }

  // Calculate "Other" from totals
  const topKSum = {
    cnt: data.reduce((sum, d) => sum + parseInt(d.cnt), 0),
    cnt_ok: data.reduce((sum, d) => sum + (parseInt(d.cnt_ok) || 0), 0),
    cnt_4xx: data.reduce((sum, d) => sum + (parseInt(d.cnt_4xx) || 0), 0),
    cnt_5xx: data.reduce((sum, d) => sum + (parseInt(d.cnt_5xx) || 0), 0)
  };
  const otherRow = totals ? {
    cnt: parseInt(totals.cnt) - topKSum.cnt,
    cnt_ok: (parseInt(totals.cnt_ok) || 0) - topKSum.cnt_ok,
    cnt_4xx: (parseInt(totals.cnt_4xx) || 0) - topKSum.cnt_4xx,
    cnt_5xx: (parseInt(totals.cnt_5xx) || 0) - topKSum.cnt_5xx
  } : null;
  const hasOther = otherRow && otherRow.cnt > 0 && getNextTopN();

  const maxCount = Math.max(...data.map(d => parseInt(d.cnt)));

  let html = `<h3>${speedIndicator}${title}${summaryHtml}`;
  if (hasFilters) {
    html += ` <button class="clear-facet-btn" onclick="clearFiltersForColumn('${colEscaped}')">Clear</button>`;
  }
  html += `</h3><table class="breakdown-table">`;

  for (const row of data) {
    const cnt = parseInt(row.cnt);
    const cntOk = parseInt(row.cnt_ok) || 0;
    const cnt4xx = parseInt(row.cnt_4xx) || 0;
    const cnt5xx = parseInt(row.cnt_5xx) || 0;

    // Calculate percentages relative to max count (for bar width)
    const barWidth = (cnt / maxCount) * 100;
    // Calculate percentages within this row (for stacked segments)
    const pct5xx = cnt > 0 ? (cnt5xx / cnt) * 100 : 0;
    const pct4xx = cnt > 0 ? (cnt4xx / cnt) * 100 : 0;
    const pctOk = cnt > 0 ? (cntOk / cnt) * 100 : 0;

    const dim = row.dim || '(empty)';
    const dimEscaped = (row.dim || '').replace(/'/g, "\\'").replace(/\\/g, '\\\\');

    // Check if this value is currently filtered
    const activeFilter = columnFilters.find(f => f.value === (row.dim || ''));
    const isIncluded = activeFilter && !activeFilter.exclude;
    const isExcluded = activeFilter && activeFilter.exclude;
    const rowClass = isIncluded ? 'filter-included' : (isExcluded ? 'filter-excluded' : '');

    // Build dimension cell content - with optional link and dimmed prefix
    let dimContent;
    let linkUrl = null;
    if (linkFn && row.dim) {
      linkUrl = linkFn(row.dim);
    } else if (linkPrefix && row.dim) {
      // For ASN links, extract just the number (before first space)
      const linkValue = row.dim.split(' ')[0];
      linkUrl = linkPrefix + linkValue + (linkSuffix || '');
    }
    const formattedDim = formatDimWithPrefix(dim, dimPrefixes, dimFormatFn);

    // Get color indicator using unified color system
    const colorIndicator = getColorIndicatorHtml(col, row.dim);

    if (linkUrl) {
      dimContent = `${colorIndicator}<a href="${linkUrl}" target="_blank" rel="noopener">${formattedDim}</a>`;
    } else {
      dimContent = `${colorIndicator}${formattedDim}`;
    }

    // Determine button actions based on current filter state
    const filterBtn = isIncluded
      ? `<button class="action-btn" onclick="removeFilterByValue('${colEscaped}', '${dimEscaped}')">Clear</button>`
      : `<button class="action-btn" onclick="addFilter('${colEscaped}', '${dimEscaped}', false)">Filter</button>`;
    const excludeBtn = isExcluded
      ? `<button class="action-btn" onclick="removeFilterByValue('${colEscaped}', '${dimEscaped}')">Clear</button>`
      : `<button class="action-btn exclude" onclick="addFilter('${colEscaped}', '${dimEscaped}', true)">Exclude</button>`;

    // Mobile action buttons (shown on tap) - using Unicode symbols
    // + for filter, × for exclude, ✓ for clear
    const mobileFilterBtn = isIncluded
      ? `<button class="mobile-action-btn active" onclick="removeFilterByValue('${colEscaped}', '${dimEscaped}')" title="Remove filter">✓</button>`
      : `<button class="mobile-action-btn" onclick="addFilter('${colEscaped}', '${dimEscaped}', false)" title="Filter to this value">+</button>`;
    const mobileExcludeBtn = isExcluded
      ? `<button class="mobile-action-btn exclude active" onclick="removeFilterByValue('${colEscaped}', '${dimEscaped}')" title="Remove exclusion">✓</button>`
      : `<button class="mobile-action-btn exclude" onclick="addFilter('${colEscaped}', '${dimEscaped}', true)" title="Exclude this value">×</button>`;

    html += `
      <tr class="${rowClass}">
        <td class="dim" title="${escapeHtml(dim)}">${dimContent}</td>
        <td class="count">
          <span class="value">${formatNumber(cnt)}</span>
          ${filterBtn}
        </td>
        <td class="bar">
          <div class="bar-inner" style="width: ${barWidth}%">
            <div class="bar-segment bar-5xx" style="width: ${pct5xx}%"></div>
            <div class="bar-segment bar-4xx" style="width: ${pct4xx}%"></div>
            <div class="bar-segment bar-ok" style="width: ${pctOk}%"></div>
          </div>
          ${excludeBtn}
        </td>
        <td class="mobile-actions">${mobileFilterBtn}${mobileExcludeBtn}</td>
      </tr>
    `;
  }

  // Add "Other" row if there are more values beyond topN
  if (hasOther) {
    const cnt = otherRow.cnt;
    const cntOk = otherRow.cnt_ok;
    const cnt4xx = otherRow.cnt_4xx;
    const cnt5xx = otherRow.cnt_5xx;
    // Cap bar width at 100% (same as top value) to prevent layout explosion
    const isOverflow = cnt > maxCount;
    const barWidth = isOverflow ? 100 : (cnt / maxCount) * 100;
    const pct5xx = cnt > 0 ? (cnt5xx / cnt) * 100 : 0;
    const pct4xx = cnt > 0 ? (cnt4xx / cnt) * 100 : 0;
    const pctOk = cnt > 0 ? (cntOk / cnt) * 100 : 0;
    const nextN = getNextTopN();
    const overflowClass = isOverflow ? ' bar-overflow' : '';

    html += `
      <tr class="other-row" onclick="increaseTopN()" title="Click to show top ${nextN}">
        <td class="dim"><span class="dim-prefix">(other)</span></td>
        <td class="count">
          <span class="value">${formatNumber(cnt)}</span>
        </td>
        <td class="bar">
          <div class="bar-inner${overflowClass}" style="width: ${barWidth}%">
            <div class="bar-segment bar-5xx" style="width: ${pct5xx}%"></div>
            <div class="bar-segment bar-4xx" style="width: ${pct4xx}%"></div>
            <div class="bar-segment bar-ok" style="width: ${pctOk}%"></div>
          </div>
        </td>
        <td class="mobile-actions"></td>
      </tr>
    `;
  }

  html += '</table>';
  card.innerHTML = html;
}

export function renderBreakdownError(id, message) {
  const card = document.getElementById(id);
  const title = card.querySelector('h3').textContent;
  card.innerHTML = `<h3>${title}</h3><div class="empty">Error loading data</div>`;
}
