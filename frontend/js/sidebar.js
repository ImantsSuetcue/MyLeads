// Highlights the current page's sidebar nav link. Included on every
// authenticated page alongside the (identical) sidebar markup — centralizes
// the "which link is active" logic instead of hand-setting it per page.
document.addEventListener('DOMContentLoaded', () => {
  const current = location.pathname.split('/').pop() || 'dashboard.html';
  document.querySelectorAll('.sidebar-nav a[href]').forEach((link) => {
    const href = link.getAttribute('href').split('?')[0];
    if (href === current) {
      link.classList.add('active');
    }
  });
});
