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

const contexts = new Map();

function getContext(scope) {
  const key = scope || 'dashboard';
  if (!contexts.has(key)) {
    contexts.set(key, { requestId: 0, controller: null });
  }
  return contexts.get(key);
}

export function startRequestContext(scope) {
  const ctx = getContext(scope);
  if (ctx.controller) {
    ctx.controller.abort();
  }
  ctx.controller = new AbortController();
  ctx.requestId += 1;
  return {
    requestId: ctx.requestId,
    signal: ctx.controller.signal,
    scope: scope || 'dashboard',
  };
}

export function getRequestContext(scope) {
  const ctx = getContext(scope);
  return {
    requestId: ctx.requestId,
    signal: ctx.controller ? ctx.controller.signal : undefined,
    scope: scope || 'dashboard',
  };
}

export function isRequestCurrent(requestId, scope) {
  const ctx = getContext(scope);
  return requestId === ctx.requestId;
}

export function mergeAbortSignals(signals) {
  const activeSignals = (signals || []).filter(Boolean);
  if (activeSignals.length === 0) return undefined;
  if (activeSignals.length === 1) return activeSignals[0];

  if (typeof AbortSignal.any === 'function') {
    return AbortSignal.any(activeSignals);
  }

  const controller = new AbortController();
  const onAbort = () => controller.abort();

  for (const signal of activeSignals) {
    if (signal.aborted) {
      controller.abort();
      return controller.signal;
    }
    signal.addEventListener('abort', onAbort, { once: true });
  }

  return controller.signal;
}
