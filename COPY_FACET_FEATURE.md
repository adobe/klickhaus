# Copy Facet to TSV Feature

## Overview

Added ability to copy facet data as Tab-Separated Values (TSV) for pasting into spreadsheets like Excel, Google Sheets, or Numbers.

## Implementation

### Files Created

1. **`/js/copy-facet.js`** - Core copy functionality
   - `copyFacetAsTsv(facetId)` - Main function to copy facet data
   - `showCopyFeedback(card, success)` - Visual feedback (✓/✗)
   - Formats data with headers: Value, Count, OK (2xx/3xx), 4xx, 5xx

### Files Modified

1. **`/js/breakdowns/render.js`**
   - Added `copyBtnHtml` in facet header
   - Stores facet data in `card.dataset.facetData` (JSON format)
   - Data includes: title, data rows, totals, mode (count/bytes)

2. **`/js/ui/actions.js`**
   - Added `copy-facet-tsv` action handler
   - Added `copyFacetTsv` to ActionHandlers typedef

3. **`/js/main.js`** and **`/js/delivery-main.js`**
   - Import `copyFacetAsTsv` from `./copy-facet.js`
   - Register `copyFacetTsv: copyFacetAsTsv` in action handlers

4. **`/css/facets.css`**
   - Added `.copy-facet-btn` styles
   - Transparent background with hover effect
   - Positioned next to mode toggle button

5. **`/README.md`**
   - Added "Copy to spreadsheet" feature in Features list
   - Added "Copy Facet Data to Spreadsheet" section with usage instructions

## User Experience

### UI Element
- **Location**: Facet header, between title and mode toggle (if present)
- **Label**: "copy"
- **Tooltip**: "Copy data as TSV (paste into spreadsheet)"

### Interaction Flow
1. User clicks "copy" button on any facet
2. Data is copied to clipboard as TSV
3. Button shows ✓ (green) for 1.5 seconds on success
4. Button shows ✗ (red) for 1.5 seconds on error
5. User can paste directly into any spreadsheet application

### Data Format

**TSV Output:**
```
Value	Count	OK (2xx/3xx)	4xx	5xx
example.com	12500	12000	400	100
other.com	5000	4800	150	50
...
```

**Numeric Format:**
- Count mode: Raw integers (e.g., `12500`)
- Bytes mode: Raw integers (e.g., `1048576` for 1 MB)
- Preserves numeric types for spreadsheet calculations

## Technical Details

### Data Storage
Facet data is stored in `card.dataset.facetData` as JSON:

```javascript
{
  title: "Hosts",
  data: [
    { dim: "example.com", cnt: 12500, cnt_ok: 12000, cnt_4xx: 400, cnt_5xx: 100 },
    // ...
  ],
  totals: { cnt: 50000, cnt_ok: 48000, cnt_4xx: 1500, cnt_5xx: 500 },
  mode: "count" // or "bytes"
}
```

### Clipboard API
- Uses modern `navigator.clipboard.writeText()` API
- Async/await for proper error handling
- Requires HTTPS or localhost (browser security)

### Browser Support
- Chrome/Edge: Full support
- Firefox: Full support  
- Safari: Full support (iOS 13.4+)
- Fallback: Shows error feedback if clipboard API unavailable

## Testing Checklist

- [x] Copy button appears on all facets
- [x] Click copies data to clipboard
- [x] Success feedback shows ✓ in green
- [x] Pasted data has correct TSV format
- [x] Headers match: Value, Count, OK, 4xx, 5xx
- [x] Numeric values preserved (no formatting)
- [x] Works in count mode
- [x] Works in bytes mode
- [x] Works with filtered facets
- [x] Works with pinned/hidden facets
- [x] Button style matches UI design
- [x] Tooltip explains functionality
- [x] No linter errors

## Future Enhancements

Potential improvements:
1. Add CSV option (comma-separated instead of tab)
2. Include "Other" row in export if present
3. Add percentage columns (e.g., "4xx %" and "5xx %")
4. Include time range and filters in export header
5. Support exporting multiple facets at once
6. Add keyboard shortcut (e.g., `Cmd+C` on focused facet)
7. Export with formatted numbers option (e.g., "12.5K" instead of "12500")
8. Export to Excel format (.xlsx) directly
