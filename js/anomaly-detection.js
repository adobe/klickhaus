/**
 * Anomaly detection utilities module.
 * Contains ID generation, caching logic, and pure detection functions.
 *
 * @module anomaly-detection
 */

// Cache version - increment when cache format or algorithm changes
export const CACHE_VERSION = 3;

// Number of contributors to cache vs highlight
export const CACHE_TOP_N = 30;

// Car-themed word lists for generating stable IDs
const CAR_ADJECTIVES = [
  'alpine', 'azure', 'blazing', 'bold', 'brilliant', 'chrome', 'classic',
  'coastal', 'cosmic', 'crimson', 'crystal', 'daring', 'dazzling', 'dusty',
  'electric', 'elegant', 'ember', 'emerald', 'fierce', 'fiery', 'flash',
  'forest', 'frozen', 'gentle', 'gilded', 'gleaming', 'golden', 'granite',
  'hidden', 'highland', 'icy', 'ivory', 'jade', 'jet', 'lunar', 'marble',
  'midnight', 'misty', 'moonlit', 'neon', 'noble', 'obsidian', 'ocean',
  'onyx', 'opulent', 'pearl', 'phantom', 'polar', 'pristine', 'radiant',
  'raven', 'royal', 'ruby', 'rustic', 'sable', 'sapphire', 'scarlet',
  'shadow', 'silent', 'silver', 'sleek', 'smoky', 'solar', 'sonic',
  'speedy', 'starlit', 'steel', 'storm', 'sunset', 'swift', 'teal',
  'thunder', 'titan', 'turbo', 'twilight', 'velvet', 'vintage', 'violet',
  'wild', 'winter', 'zephyr'
];

// Car colors organized by severity for anomaly ID generation
const CAR_COLORS_RED = [
  'burgundy', 'cardinal', 'carmine', 'cerise', 'cherry', 'claret', 'coral',
  'cranberry', 'crimson', 'garnet', 'magenta', 'maroon', 'raspberry', 'rose',
  'ruby', 'russet', 'rust', 'scarlet', 'vermillion', 'wine'
];

const CAR_COLORS_ORANGE = [
  'amber', 'apricot', 'bronze', 'burnt', 'butterscotch', 'caramel', 'carrot',
  'cinnamon', 'copper', 'flame', 'ginger', 'gold', 'honey', 'marigold',
  'melon', 'ochre', 'orange', 'papaya', 'peach', 'pumpkin', 'saffron',
  'sand', 'sienna', 'tan', 'tangerine', 'tawny', 'topaz', 'yellow'
];

const CAR_COLORS_COOL = [
  'aqua', 'azure', 'blue', 'cerulean', 'chartreuse', 'cobalt', 'cyan',
  'emerald', 'forest', 'green', 'hunter', 'indigo', 'jade', 'lagoon',
  'lime', 'mint', 'navy', 'olive', 'pacific', 'pine', 'sage', 'seafoam',
  'spruce', 'teal', 'turquoise', 'verdant', 'viridian'
];

const CAR_MODELS = [
  'accord', 'alpine', 'beetle', 'boxster', 'bronco', 'camaro', 'camry',
  'cayenne', 'challenger', 'charger', 'civic', 'cobra', 'continental',
  'corolla', 'corvette', 'defender', 'elantra', 'escort', 'explorer',
  'firebird', 'focus', 'frontier', 'fury', 'galaxie', 'giulia', 'gto',
  'impala', 'jetta', 'lancer', 'landcruiser', 'maverick', 'miata', 'monte',
  'mustang', 'navigator', 'nova', 'outback', 'panda', 'pantera', 'passat',
  'pathfinder', 'pinto', 'porsche', 'prelude', 'prius', 'quattro', 'rabbit',
  'ranger', 'raptor', 'roadster', 'safari', 'scirocco', 'senna', 'shelby',
  'sierra', 'skyline', 'solara', 'sonata', 'spark', 'spider', 'stingray',
  'supra', 'tacoma', 'tempest', 'tercel', 'thunderbird', 'tiguan', 'torino',
  'tundra', 'vantage', 'viper', 'wrangler', 'zephyr'
];

/**
 * Generate a simple hash from a string
 * @param {string} str - String to hash
 * @returns {number} Hash value
 */
export function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

/**
 * Round a date to the nearest minute for cache stability
 * @param {Date} date - Date to round
 * @returns {string} ISO string rounded to minute
 */
export function roundToMinute(date) {
  const d = new Date(date);
  d.setSeconds(0, 0);
  if (date.getSeconds() >= 30) {
    d.setMinutes(d.getMinutes() + 1);
  }
  return d.toISOString();
}

/**
 * Generate a stable car-themed ID for an anomaly
 * @param {string} baseTimeRange - The base time filter
 * @param {string} baseFilters - The active filters
 * @param {Date} anomalyStart - Anomaly start time
 * @param {Date} anomalyEnd - Anomaly end time
 * @param {string} category - Anomaly category: 'red' (5xx), 'yellow' (4xx), or 'green' (2xx/3xx)
 * @returns {string} Car-themed ID like "opulent-crimson-miata"
 */
export function generateAnomalyId(baseTimeRange, baseFilters, anomalyStart, anomalyEnd, category = 'green') {
  // Create a stable string from the inputs
  const inputStr = [
    baseTimeRange,
    baseFilters,
    roundToMinute(anomalyStart),
    roundToMinute(anomalyEnd)
  ].join('|');

  const hash = simpleHash(inputStr);

  // Select color list based on anomaly category
  let colorList;
  switch (category) {
    case 'red':
      colorList = CAR_COLORS_RED;
      break;
    case 'yellow':
      colorList = CAR_COLORS_ORANGE;
      break;
    default:
      colorList = CAR_COLORS_COOL;
  }

  // Use different parts of the hash to select words
  const adjIdx = hash % CAR_ADJECTIVES.length;
  const colorIdx = Math.floor(hash / CAR_ADJECTIVES.length) % colorList.length;
  const modelIdx = Math.floor(hash / (CAR_ADJECTIVES.length * colorList.length)) % CAR_MODELS.length;

  return `${CAR_ADJECTIVES[adjIdx]}-${colorList[colorIdx]}-${CAR_MODELS[modelIdx]}`;
}

/**
 * Generate cache key based on time and host (base dataset)
 * @param {string} timeFilter - Time filter SQL
 * @param {string} hostFilter - Host filter SQL
 * @returns {string} Cache key
 */
export function generateCacheKey(timeFilter, hostFilter) {
  return simpleHash(`${timeFilter}|${hostFilter}`).toString(36);
}

/**
 * Load cached investigation from localStorage
 * @param {string} cacheKey - Cache key
 * @param {Function} isEligibleFn - Function to check if cache is eligible
 * @returns {Object|null} Cached data or null
 */
export function loadCachedInvestigation(cacheKey, isEligibleFn) {
  try {
    const cached = localStorage.getItem(`anomaly_investigation_${cacheKey}`);
    if (!cached) {
      console.log(`No cache found for key: ${cacheKey}`);
      return null;
    }
    const data = JSON.parse(cached);
    // Check cache version and age
    if (data.version !== CACHE_VERSION) {
      console.log(`Cache version mismatch: ${data.version} vs ${CACHE_VERSION}`);
      return null;
    }
    if (Date.now() - data.timestamp >= 60 * 60 * 1000) {
      console.log('Cache expired (older than 1 hour)');
      return null;
    }
    // Check eligibility
    if (data.context && isEligibleFn(data.context)) {
      console.log(`Cache loaded: ${data.topContributors?.length || 0} contributors`);
      return data;
    } else if (!data.context) {
      console.log('Cache eligible: old format (no context)');
      return data;
    }
    return null;
  } catch (e) {
    console.warn('Failed to load cached investigation:', e);
  }
  return null;
}

/**
 * Save investigation to localStorage cache
 * @param {string} cacheKey - Cache key
 * @param {Object} data - Investigation data
 * @param {Object} context - Query context for eligibility checks
 */
export function saveCachedInvestigation(cacheKey, data, context) {
  try {
    localStorage.setItem(`anomaly_investigation_${cacheKey}`, JSON.stringify({
      ...data,
      context,
      version: CACHE_VERSION,
      timestamp: Date.now()
    }));
  } catch (e) {
    console.warn('Failed to cache investigation:', e);
  }
}

/**
 * Clear old investigation caches (keep last 10)
 */
export function cleanupOldCaches() {
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith('anomaly_investigation_')) {
        const data = JSON.parse(localStorage.getItem(key));
        keys.push({ key, timestamp: data.timestamp || 0 });
      }
    }
    // Sort by timestamp descending, remove all but the 10 most recent
    keys.sort((a, b) => b.timestamp - a.timestamp);
    keys.slice(10).forEach(({ key }) => localStorage.removeItem(key));
  } catch (e) {
    // Ignore cleanup errors
  }
}

/**
 * Build a time filter SQL clause for a specific time window
 * @param {Date} start - Window start time
 * @param {Date} end - Window end time
 * @returns {string} SQL WHERE clause
 */
export function buildTimeFilter(start, end) {
  const startIso = start.toISOString().replace('T', ' ').slice(0, 19);
  const endIso = end.toISOString().replace('T', ' ').slice(0, 19);
  return `timestamp BETWEEN toDateTime('${startIso}') AND toDateTime('${endIso}')`;
}

/**
 * Get the status filter SQL based on anomaly category
 * @param {string} category - 'red' (5xx), 'yellow' (4xx), or 'green' (2xx/3xx)
 * @returns {string} SQL condition
 */
export function getCategoryFilter(category) {
  switch (category) {
    case 'red':
      return '`response.status` >= 500';
    case 'yellow':
      return '`response.status` >= 400 AND `response.status` < 500';
    case 'green':
      return '`response.status` < 400';
    default:
      return '1=1';
  }
}

/**
 * Store anomaly ID on window object for access during zoom
 * @param {number} rank - Step rank
 * @param {string} id - Anomaly ID
 */
export function storeAnomalyIdOnStep(rank, id) {
  window._anomalyIds = window._anomalyIds || {};
  window._anomalyIds[rank] = id;
}
