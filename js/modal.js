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
let quickLinksModal = null;
let menuBtn = null;

export function openQuickLinksModal() {
  quickLinksModal.showModal();
}

export function closeQuickLinksModal() {
  quickLinksModal.close();
}

export function initModal() {
  quickLinksModal = document.getElementById('quickLinksModal');
  menuBtn = document.getElementById('menuBtn');

  // Handle messages from the iframe
  window.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'navigate') {
      closeQuickLinksModal();
      // Navigate to the new URL
      window.location.href = e.data.url;
    }
  });

  // Close modal when clicking backdrop
  quickLinksModal.addEventListener('click', (e) => {
    if (e.target === quickLinksModal) {
      closeQuickLinksModal();
    }
  });

  // Close modal when clicking header bar (easier toggle on mobile)
  const modalHeader = quickLinksModal.querySelector('.modal-header');
  modalHeader.addEventListener('click', closeQuickLinksModal);
  modalHeader.style.cursor = 'pointer';

  // Close modal on Escape key
  quickLinksModal.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeQuickLinksModal();
    }
  });

  menuBtn.addEventListener('click', openQuickLinksModal);
}
