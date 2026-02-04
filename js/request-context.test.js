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
import {
  startRequestContext,
  getRequestContext,
  isRequestCurrent,
  mergeAbortSignals,
} from './request-context.js';

describe('request-context', () => {
  it('increments requestId and aborts previous context', () => {
    const first = startRequestContext('test');
    assert.isFalse(first.signal.aborted);
    assert.isTrue(isRequestCurrent(first.requestId, first.scope));

    const second = startRequestContext('test');
    assert.isTrue(first.signal.aborted);
    assert.notStrictEqual(second.requestId, first.requestId);
    assert.isTrue(isRequestCurrent(second.requestId, second.scope));
    assert.isFalse(isRequestCurrent(first.requestId, first.scope));
  });

  it('returns current context for scope', () => {
    const ctx = startRequestContext('test-read');
    const current = getRequestContext('test-read');
    assert.strictEqual(current.requestId, ctx.requestId);
    assert.strictEqual(current.signal, ctx.signal);
  });

  it('merges abort signals with fallback when AbortSignal.any is unavailable', () => {
    const originalAny = AbortSignal.any;
    AbortSignal.any = undefined;
    try {
      const controllerA = new AbortController();
      const controllerB = new AbortController();
      const merged = mergeAbortSignals([controllerA.signal, controllerB.signal]);

      assert.isFalse(merged.aborted);
      controllerA.abort();
      assert.isTrue(merged.aborted);
    } finally {
      AbortSignal.any = originalAny;
    }
  });

  it('returns undefined for empty signal list', () => {
    const merged = mergeAbortSignals([]);
    assert.isUndefined(merged);
  });

  it('returns the same signal when only one is provided', () => {
    const controller = new AbortController();
    const merged = mergeAbortSignals([controller.signal]);
    assert.strictEqual(merged, controller.signal);
  });
});
