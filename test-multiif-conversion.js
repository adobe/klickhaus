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

import { contentLengthBuckets, timeElapsedBuckets } from './js/breakdowns/buckets.js';

// Test multiIf format
const contentLength = contentLengthBuckets(5);
const timeElapsed = timeElapsedBuckets(5);

console.log('Content Length multiIf:');
console.log(contentLength);
console.log('');

console.log('Time Elapsed multiIf:');
console.log(timeElapsed);
console.log('');

// Extract parts for manual parsing test
function parseMultiIf(expr) {
  const innerExpr = expr.replace(/^multiIf\s*\(/i, '').replace(/\)$/, '');

  // Split by commas, but respect quoted strings
  const parts = [];
  let current = '';
  let inQuote = false;
  let quoteChar = '';

  for (let i = 0; i < innerExpr.length; i += 1) {
    const char = innerExpr[i];

    if ((char === "'" || char === '"') && (i === 0 || innerExpr[i - 1] !== '\\')) {
      if (!inQuote) {
        inQuote = true;
        quoteChar = char;
      } else if (char === quoteChar) {
        inQuote = false;
      }
    }

    if (char === ',' && !inQuote) {
      parts.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  if (current) parts.push(current.trim());

  return parts;
}

console.log('Parsed Content Length parts:');
const clParts = parseMultiIf(contentLength);
clParts.forEach((part, i) => console.log(`  [${i}]: ${part}`));
console.log('');

console.log('Parsed Time Elapsed parts:');
const teParts = parseMultiIf(timeElapsed);
teParts.forEach((part, i) => console.log(`  [${i}]: ${part}`));
