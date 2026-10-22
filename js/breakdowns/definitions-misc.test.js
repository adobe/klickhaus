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
import { miscBreakdowns } from './definitions-misc.js';

describe('miscBreakdowns', () => {
  it('maps Surrogate Keys to response.headers.surrogate_key', () => {
    const b = miscBreakdowns.find((d) => d.id === 'breakdown-surrogate-key');
    assert.strictEqual(b.col, '`response.headers.surrogate_key`');
    assert.strictEqual(b.extraFilter, "AND `response.headers.surrogate_key` != ''");
  });
});
