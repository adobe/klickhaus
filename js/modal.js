// Quick links modal
let quickLinksModal = null;
let menuBtn = null;

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

  // Close modal on Escape key
  quickLinksModal.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeQuickLinksModal();
    }
  });

  menuBtn.addEventListener('click', openQuickLinksModal);
}

export function openQuickLinksModal() {
  quickLinksModal.showModal();
}

export function closeQuickLinksModal() {
  quickLinksModal.close();
}
