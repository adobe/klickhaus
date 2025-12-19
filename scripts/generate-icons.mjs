#!/usr/bin/env node
/**
 * Generate PWA icons for CDN Analytics
 *
 * Requires: npm install canvas
 * Run: node scripts/generate-icons.mjs
 */

import { createCanvas } from 'canvas';
import { writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const iconsDir = join(__dirname, '..', 'icons');

// Theme color from the app
const THEME_COLOR = '#4a90d9';
const DARK_BG = '#1a1a2e';

// Icon sizes to generate
const SIZES = [16, 32, 180, 192, 512];
const MASKABLE_SIZES = [512];

function drawIcon(ctx, size, isMaskable = false) {
  const padding = isMaskable ? size * 0.1 : size * 0.15;
  const innerSize = size - (padding * 2);

  // Background
  ctx.fillStyle = THEME_COLOR;
  if (isMaskable) {
    // Maskable icons need full bleed
    ctx.fillRect(0, 0, size, size);
  } else {
    // Regular icons get rounded corners
    const radius = size * 0.2;
    ctx.beginPath();
    ctx.roundRect(0, 0, size, size, radius);
    ctx.fill();
  }

  // Draw a simple bar chart
  ctx.fillStyle = '#ffffff';

  const barCount = 4;
  const barWidth = innerSize / (barCount * 2);
  const barSpacing = barWidth;
  const startX = padding + barSpacing / 2;
  const baseY = padding + innerSize;

  // Bar heights as percentages
  const heights = [0.4, 0.7, 0.5, 0.9];

  heights.forEach((h, i) => {
    const x = startX + (i * (barWidth + barSpacing));
    const barHeight = innerSize * h;
    const y = baseY - barHeight;

    // Draw bar with rounded top
    const barRadius = barWidth * 0.2;
    ctx.beginPath();
    ctx.roundRect(x, y, barWidth, barHeight, [barRadius, barRadius, 0, 0]);
    ctx.fill();
  });

  // Add a subtle trend line
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
  ctx.lineWidth = size * 0.02;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.beginPath();
  const lineY = padding + innerSize * 0.25;
  ctx.moveTo(padding, lineY + innerSize * 0.1);
  ctx.lineTo(padding + innerSize * 0.3, lineY);
  ctx.lineTo(padding + innerSize * 0.6, lineY + innerSize * 0.15);
  ctx.lineTo(padding + innerSize, lineY - innerSize * 0.05);
  ctx.stroke();
}

function generateIcon(size, isMaskable = false) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  // Enable anti-aliasing
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  drawIcon(ctx, size, isMaskable);

  return canvas.toBuffer('image/png');
}

// Ensure icons directory exists
mkdirSync(iconsDir, { recursive: true });

// Generate regular icons
for (const size of SIZES) {
  const buffer = generateIcon(size, false);
  const filename = `icon-${size}.png`;
  writeFileSync(join(iconsDir, filename), buffer);
  console.log(`Generated ${filename}`);
}

// Generate maskable icons
for (const size of MASKABLE_SIZES) {
  const buffer = generateIcon(size, true);
  const filename = `icon-maskable-${size}.png`;
  writeFileSync(join(iconsDir, filename), buffer);
  console.log(`Generated ${filename}`);
}

console.log('\nAll icons generated successfully!');
