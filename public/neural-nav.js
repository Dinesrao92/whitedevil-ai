/* Keyboard behavior for the responsive drawer, independent of chat state. */
(() => {
  'use strict';
  const shell = document.getElementById('app-shell');
  const sidebar = document.getElementById('sidebar');
  const trigger = document.getElementById('mobile-menu');
  const main = document.querySelector('.main-area');
  const mobile = matchMedia('(max-width: 720px)');
  let wasOpen = false;
  function sync() {
    const open = mobile.matches && shell.classList.contains('sidebar-open');
    sidebar.inert = mobile.matches && !open;
    main.inert = open;
    if (open && !wasOpen) document.getElementById('sidebar-close').focus();
    if (!open && wasOpen && sidebar.contains(document.activeElement)) trigger.focus();
    wasOpen = open;
  }
  new MutationObserver(sync).observe(shell, { attributes: true, attributeFilter: ['class'] });
  mobile.addEventListener('change', sync);
  document.addEventListener('keydown', event => {
    if (!wasOpen || event.key !== 'Tab') return;
    const items = [...sidebar.querySelectorAll('button:not(:disabled), a[href], textarea:not(:disabled)')].filter(el => el.getClientRects().length);
    const first = items[0], last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  });
  sync();
})();
