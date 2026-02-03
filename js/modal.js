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
let moreMenu = null;
let menuBtn = null;
let moreBtn = null;

export function openQuickLinksModal() {
  quickLinksModal.showModal();
}

export function closeQuickLinksModal() {
  quickLinksModal.close();
}

export function openMoreMenu() {
  if (!moreBtn || !moreMenu) return;

  // Position the menu below the button
  const rect = moreBtn.getBoundingClientRect();
  moreMenu.style.top = `${rect.bottom + 4}px`;
  moreMenu.style.left = `${rect.right - 200}px`; // Align right edge with button

  moreMenu.showModal();
}

export function closeMoreMenu() {
  if (moreMenu) {
    moreMenu.close();
  }
}

export function initModal() {
  quickLinksModal = document.getElementById('quickLinksModal');
  moreMenu = document.getElementById('moreMenu');
  menuBtn = document.getElementById('menuBtn');
  moreBtn = document.getElementById('moreBtn');

  // Handle messages from the iframe
  window.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'navigate') {
      closeQuickLinksModal();
      // Navigate to the new URL
      window.location.href = e.data.url;
    }
  });

  // Close quick links modal when clicking backdrop
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

  // More menu handling
  if (moreBtn && moreMenu) {
    moreBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openMoreMenu();
    });

    // Close more menu when clicking backdrop or outside
    moreMenu.addEventListener('click', (e) => {
      if (e.target === moreMenu) {
        closeMoreMenu();
      }
    });

    // Close menu when clicking any menu item
    moreMenu.querySelectorAll('.menu-item').forEach((item) => {
      item.addEventListener('click', () => {
        closeMoreMenu();
      });
    });

    // Close more menu on Escape
    moreMenu.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeMoreMenu();
      }
    });

    // Close more menu when clicking outside
    document.addEventListener('click', (e) => {
      if (moreMenu.open && !moreMenu.contains(e.target) && e.target !== moreBtn) {
        closeMoreMenu();
      }
    });
  }
}
