(function () {
  function initTabs(tablist) {
    var tabs = Array.prototype.slice.call(tablist.querySelectorAll('[role="tab"]'));
    if (!tabs.length) return;
    var panels = tabs.map(function (tab) {
      return document.getElementById(tab.getAttribute('aria-controls'));
    });
    var defaultIndex = Math.max(0, tabs.findIndex(function (tab) {
      return tab.getAttribute('aria-selected') === 'true';
    }));

    function activate(index, focus, updateHash) {
      tabs.forEach(function (tab, i) {
        var selected = i === index;
        tab.setAttribute('aria-selected', String(selected));
        tab.tabIndex = selected ? 0 : -1;
        if (panels[i]) panels[i].hidden = !selected;
      });
      if (focus) tabs[index].focus();
      if (updateHash && window.history && window.history.replaceState) {
        window.history.replaceState(window.history.state, '', '#' + tabs[index].dataset.tab);
      }
    }

    tabs.forEach(function (tab, index) {
      tab.addEventListener('click', function () {
        activate(index, false, true);
      });
      tab.addEventListener('keydown', function (e) {
        var next = null;
        if (e.key === 'ArrowRight') next = (index + 1) % tabs.length;
        else if (e.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
        else if (e.key === 'Home') next = 0;
        else if (e.key === 'End') next = tabs.length - 1;
        if (next !== null) {
          e.preventDefault();
          activate(next, true, true);
        }
      });
    });

    // Overview links may be far below the tabs. Bring the selected explorer
    // back into view, while preserving normal modified-click link behavior.
    document.addEventListener('click', function (event) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      var link = event.target.closest('a[href^="#"]');
      if (!link || link.hasAttribute('download') || link.target) return;
      var hash = link.getAttribute('href');
      var index = tabs.findIndex(function (tab) { return '#' + tab.dataset.tab === hash; });
      if (index < 0) return;
      event.preventDefault();
      if (window.location.hash !== hash) window.history.pushState(window.history.state, '', hash);
      activate(index, false, false);
      tabs[index].focus({ preventScroll: true });
      tablist.scrollIntoView({ block: 'start' });
    });

    function activateFromHash() {
      var hash = window.location.hash.slice(1);
      var hashIndex = tabs.findIndex(function (tab) { return tab.dataset.tab === hash; });
      if (hashIndex > -1) activate(hashIndex, false, false);
      else if (!hash) activate(defaultIndex, false, false);
    }

    // Same-page links and browser history change the hash without reloading.
    window.addEventListener('hashchange', activateFromHash);
    window.addEventListener('pageshow', activateFromHash);
    activateFromHash();
  }

  document.querySelectorAll('[role="tablist"]').forEach(initTabs);
})();
