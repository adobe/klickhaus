# Filter UX Changes - Simplified Toggle with Alt+Click for Exclude

## Summary

Changed the facet value filtering behavior from a 3-state rotation (None → Include → Exclude → None) to a simpler 2-state toggle (None ↔ Include), with Alt+click providing access to the exclude functionality when needed.

## Motivation

The exclude filter state is rarely used, so cycling through it on every click added unnecessary complexity to the common workflow. The new behavior optimizes for the common case (filtering to a value) while still providing access to exclude via a modifier key.

## Changes

### Behavior Changes

**Before:**
- Click: None → Include
- Click again: Include → Exclude  
- Click again: Exclude → None

**After:**
- Click: None ↔ Include (simple toggle)
- Shift+Click: None ↔ Exclude (exceptional case)

### Code Changes

1. **`js/ui/actions.js`**
   - `add-filter` action: Kept existing `event.shiftKey` check for exclude
   - `remove-filter-value` action: Simplified from 3-state cycle to simple removal

2. **`js/templates/breakdown-table.js`**
   - Updated comment to reflect new toggle behavior

3. **`dashboard.html` and `delivery.html`**
   - Updated keyboard help dialog to mention "Shift+click for exclude"

## User-Facing Changes

### Mouse Interaction
- **Regular click on facet value**: Toggles between filtered and unfiltered
- **Shift+click on facet value**: Toggles between excluded and unfiltered
- **Click on active filter tag**: Removes the filter (same as before)

### Keyboard Interaction
- **`i`, `c`, or `Space`**: Toggle include filter (unchanged)
- **`e` or `x`**: Toggle exclude filter (unchanged)

### Discoverability
- Keyboard help dialog now shows: "Toggle filter on value (Shift+click for exclude)"
- Exclude functionality is still accessible via keyboard shortcuts `e` and `x`

## Benefits

1. **Simpler common case**: One click to filter, one click to clear
2. **Fewer accidental excludes**: Users won't accidentally cycle into exclude state
3. **Still accessible**: Shift+click preserves the existing shortcut for exclude
4. **Consistent with keyboard**: The keyboard still has dedicated exclude keys (`e`/`x`)
5. **Minimal change**: Users who already discovered Shift+click won't need to relearn

## Testing

Manual testing should verify:
1. Click on facet value filters to that value
2. Click again on filtered value clears the filter
3. Shift+click on facet value excludes that value
4. Shift+click again on excluded value clears the exclude filter
5. Keyboard shortcuts `i`/`c`/`Space` and `e`/`x` still work as expected
6. Filter tags in header still show correct state (include vs exclude)
7. Visual indicators (checkmark vs ×) display correctly
