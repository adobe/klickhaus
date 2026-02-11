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
import { assert } from 'chai';
import { createLimiter } from './concurrency-limiter.js';

describe('createLimiter', () => {
  it('returns a function', () => {
    const limit = createLimiter(2);
    assert.isFunction(limit);
  });

  it('runs tasks up to the concurrency limit in parallel', async () => {
    const limit = createLimiter(2);
    let active = 0;
    let maxActive = 0;

    const task = () => limit(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => {
        setTimeout(r, 50);
      });
      active -= 1;
    });

    await Promise.all([task(), task(), task(), task()]);
    assert.strictEqual(maxActive, 2);
  });

  it('queues tasks beyond the concurrency limit', async () => {
    const limit = createLimiter(1);
    const order = [];

    const task = (id) => limit(async () => {
      order.push(`start-${id}`);
      await new Promise((r) => {
        setTimeout(r, 10);
      });
      order.push(`end-${id}`);
    });

    await Promise.all([task('a'), task('b'), task('c')]);
    assert.deepEqual(order, [
      'start-a', 'end-a',
      'start-b', 'end-b',
      'start-c', 'end-c',
    ]);
  });

  it('returns the result of the wrapped function', async () => {
    const limit = createLimiter(2);
    const result = await limit(async () => 42);
    assert.strictEqual(result, 42);
  });

  it('propagates errors from the wrapped function', async () => {
    const limit = createLimiter(2);
    try {
      await limit(async () => {
        throw new Error('test error');
      });
      assert.fail('should have thrown');
    } catch (err) {
      assert.strictEqual(err.message, 'test error');
    }
  });

  it('releases slot on error so queued tasks still run', async () => {
    const limit = createLimiter(1);
    let secondRan = false;

    const failing = limit(async () => {
      throw new Error('fail');
    }).catch(() => {});
    const passing = limit(async () => {
      secondRan = true;
    });

    await Promise.all([failing, passing]);
    assert.isTrue(secondRan, 'queued task should run after error');
  });

  it('defaults to concurrency of 4', async () => {
    const limit = createLimiter();
    let active = 0;
    let maxActive = 0;

    const task = () => limit(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => {
        setTimeout(r, 30);
      });
      active -= 1;
    });

    await Promise.all(Array.from({ length: 8 }, () => task()));
    assert.strictEqual(maxActive, 4);
  });

  it('handles synchronous functions', async () => {
    const limit = createLimiter(2);
    const result = await limit(() => 'sync-result');
    assert.strictEqual(result, 'sync-result');
  });
});
