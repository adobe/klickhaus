# Delivery Dashboard Implementation

## Overview

Created a focused "Delivery Dashboard" at `delivery.html` for monitoring core CDN delivery traffic, with a streamlined set of facets relevant to delivery operations.

## Files Created

### 1. `/delivery.html`
- New HTML file based on `dashboard.html` structure
- Same authentication, UI, and feature set as main dashboard
- References `js/delivery-main.js` instead of `js/main.js`
- Includes all facet cards (8 visible by default, rest hidden)

### 2. `/js/delivery-main.js`
- Delivery-specific entry point (copied from `main.js` with modifications)
- **Key differences:**
  - Sets `state.title = 'Delivery'` by default
  - Configures default visible facets (8 core delivery facets)
  - Configures default hidden facets (all others)
  - Uses separate localStorage key for facet preferences (`facetPrefs_Delivery`)
  - No pre-filtering of data (shows all traffic by default)

## Files Modified

### 1. `/js/breakdowns/definitions.js`
- **Added:** `breakdown-source` facet to show CDN source (Fastly vs Cloudflare)
- Position: Second facet (after status-range)
- Configuration: `col: '`source`'`, with summary showing Fastly percentage

### 2. `/dashboard.html`
- **Added:** `<div class="breakdown-card" id="breakdown-source">` for the new Source facet
- Position: After Status Range, before Hosts

### 3. `/index.html`
- **Added:** Link to Delivery Dashboard in the "Overview & Quick Access" section
- Description includes list of default facets

### 4. `/README.md`
- **Added:** "Delivery Dashboard" subsection under "Usage"
- Documents data scope, default facets, and hidden facets
- Explains localStorage-based facet preferences

## Default Configuration

### Visible Facets (8)
1. **Status Range** - HTTP status code ranges (2xx, 4xx, 5xx)
2. **Source** - CDN source (Fastly vs Cloudflare)
3. **Hostname** - Request hostname (`request.host`)
4. **Forwarded Hosts (XFH)** - Origin hostname from X-Forwarded-Host header
5. **X-Error** - Error messages from `x_error` response header
6. **Paths** - Request URL paths
7. **User Agents** - Client user agents
8. **Tech Stack** - Backend type (`helix.backend_type`)
9. **BYO CDN Type** - BYOCDN type from `x_byo_cdn_type` header

### Hidden Facets (16)
All other facets from main dashboard are available but hidden by default:
- Content Types, Status Codes, Cache Status
- Referers, IP Addresses, Request Types
- HTTP Methods, Datacenters, ASN
- Accept, Accept-Encoding, Cache-Control (Req)
- Push Invalidation, Content Length, Redirect Location
- Response Time

Users can show/hide facets using:
- `d` keyboard shortcut (on focused facet)
- `g` keyboard shortcut (facet palette for quick navigation)

## Data Scope

**Hard-coded exclusions** - Dashboard excludes backend/admin/RUM/docs services at the SQL query level (not shown as user filters):

**Excluded hosts (15 total):**
- `config.aem.page` - Configuration service
- `pipeline.aem-fastly.page` - Pipeline service
- `config.aem-cloudflare.page` - Config service (Cloudflare)
- `admin.hlx.page` - Admin service
- `media.aem-fastly.page` - Media service
- `admin.da.live` - Admin service (da.live)
- `static.aem-fastly.page` - Static assets service
- `rum.aem.page` - Real User Monitoring
- `rum.hlx.page` - Real User Monitoring (legacy)
- `content.da.live` - Content service (da.live)
- `da.live` - Main da.live domain
- `b4adf6cfdac0918eb6aa5ad033da0747.r2.cloudflarestorage.com` - R2 storage
- `docs.da.live` - Documentation service
- `rum.aem-cloudflare.page` - Real User Monitoring (Cloudflare)
- `translate.da.live` - Translation service

**Implementation:**
- Exclusions are baked into all SQL queries via `state.additionalWhereClause`
- Applied to: facet queries, time series chart, logs view
- Not visible in active filters bar
- Cannot be removed by users (use main dashboard for all traffic)

**Focus:**
- Core delivery traffic: *.aem.live and *.aem.page user-facing endpoints
- Fastly helix5 service (In8SInYz3UQGjyG0GPZM42)
- Cloudflare zones: aem.live and aem.page

**Customization:**
- Users can add additional filters on top of exclusions
- For full traffic including backend services, use main `dashboard.html`

## Technical Notes

### Facet Preferences
- Stored in localStorage with key `facetPrefs_Delivery`
- Separate from main dashboard preferences (`facetPrefs`)
- Persists: pinned facets, hidden facets
- Reset by clearing localStorage or setting facets manually

### URL State
- Same URL parameter support as main dashboard
- `?t=1h&n=10` - time range and top N
- `?filters=[...]` - facet filters (JSON)
- `?pinned=...` - pinned log columns
- `?title=Delivery` - dashboard title (auto-set)

### Adding Facets
To add more visible facets by default:
1. Add facet ID to `DEFAULT_VISIBLE_FACETS` in `js/delivery-main.js`
2. Ensure corresponding `<div class="breakdown-card">` exists in `delivery.html`

To move facets between visible/hidden:
1. Update `DEFAULT_VISIBLE_FACETS` array
2. Update `DEFAULT_HIDDEN_FACETS` array
3. Move corresponding HTML `<div>` between sections

## Testing Checklist

- [ ] Delivery dashboard loads and authenticates
- [ ] All 9 default facets are visible
- [ ] All 16 hidden facets are in hidden section
- [ ] Source facet shows Fastly/Cloudflare breakdown
- [ ] Keyboard shortcuts work (d, g, p, etc.)
- [ ] Facet preferences persist after refresh
- [ ] Facet preferences are separate from main dashboard
- [ ] URL state persists and restores correctly
- [ ] Filtering works on all facets
- [ ] Chart and logs view work correctly
- [ ] Link from index.html navigates correctly

## Future Enhancements

Potential improvements:
1. Add pre-filtering option via URL parameter (e.g., `?preset=delivery`)
2. Add more delivery-specific facets (e.g., cache-tag, cdn-cache-control)
3. Create delivery-specific quick links in index.html
4. Add delivery-specific anomaly detection rules
5. Add delivery-specific summary metrics above chart
