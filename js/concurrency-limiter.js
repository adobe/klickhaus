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

/**
 * Create a concurrency limiter that queues async tasks when the limit is reached.
 * @param {number} maxConcurrent - Maximum number of tasks that can run simultaneously
 * @returns {function(function(): Promise): Promise} - Wrapper that limits concurrency
 */
export function createLimiter(maxConcurrent = 4) {
  let active = 0;
  const queue = [];

  function next() {
    if (queue.length === 0 || active >= maxConcurrent) return;
    active += 1;
    const { resolve } = queue.shift();
    resolve();
  }

  return async function limit(fn) {
    if (active >= maxConcurrent) {
      await new Promise((resolve) => {
        queue.push({ resolve });
      });
    } else {
      active += 1;
    }
    try {
      return await fn();
    } finally {
      active -= 1;
      next();
    }
  };
}
