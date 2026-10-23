(function () {
  'use strict';
  var header = document.querySelector('.site-header');
  var toggle = document.querySelector('.menu-toggle');
  if (!header || !toggle) return;
  header.setAttribute('data-menu-ready', '');
  toggle.hidden = false;
  function setOpen(open) {
    header.toggleAttribute('data-menu-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.textContent = open ? 'Close' : 'Menu';
  }
  toggle.addEventListener('click', function () {
    setOpen(toggle.getAttribute('aria-expanded') !== 'true');
  });
  header.querySelectorAll('.site-nav a').forEach(function (link) {
    link.addEventListener('click', function () { setOpen(false); });
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
      setOpen(false);
      toggle.focus();
    }
  });
})();
