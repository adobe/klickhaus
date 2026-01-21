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
import { TIME_RANGES, TIME_RANGE_ORDER, TOP_N_OPTIONS } from '../constants.js';

/**
 * Populate time range select options from constants.
 * @param {HTMLSelectElement} select
 */
export function populateTimeRangeSelect(selectEl) {
  if (!selectEl) return;
  const select = selectEl;
  select.innerHTML = '';

  const customOption = document.createElement('option');
  customOption.value = 'custom';
  customOption.disabled = true;
  customOption.hidden = true;
  customOption.textContent = 'Custom';
  select.appendChild(customOption);

  TIME_RANGE_ORDER.forEach((key) => {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = TIME_RANGES[key].label;
    select.appendChild(option);
  });
}

/**
 * Populate top-N select options from constants.
 * @param {HTMLSelectElement} select
 */
export function populateTopNSelect(selectEl) {
  if (!selectEl) return;
  const select = selectEl;
  select.innerHTML = '';

  TOP_N_OPTIONS.forEach((value) => {
    const option = document.createElement('option');
    option.value = String(value);
    option.textContent = `Top ${value}`;
    select.appendChild(option);
  });
}

/**
 * Update time range labels based on viewport size.
 * @param {HTMLSelectElement} select
 */
export function updateTimeRangeLabels(select) {
  if (!select) return;

  const isMobile = window.innerWidth < 600;
  TIME_RANGE_ORDER.forEach((key) => {
    const option = select.querySelector(`option[value="${key}"]`);
    if (!option) return;
    option.textContent = isMobile ? TIME_RANGES[key].shortLabel : TIME_RANGES[key].label;
  });
}
