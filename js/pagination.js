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

export const PAGE_SIZE = 500;

export class PaginationState {
  constructor(pageSize = PAGE_SIZE) {
    this.cursor = null;
    this.hasMore = true;
    this.loading = false;
    this.pageSize = pageSize;
  }

  reset() {
    this.cursor = null;
    this.hasMore = true;
    this.loading = false;
  }

  recordPage(rows) {
    const resultLength = rows.length;
    this.hasMore = resultLength === this.pageSize;
    if (resultLength > 0) {
      this.cursor = rows[resultLength - 1].timestamp;
    }
  }

  canLoadMore() {
    return this.hasMore && !this.loading && this.cursor != null;
  }

  shouldTriggerLoad(scrollPercent, globalLoading) {
    return scrollPercent > 0.5 && this.canLoadMore() && !globalLoading;
  }
}
