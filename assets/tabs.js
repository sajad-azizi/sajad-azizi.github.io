(function () {
  function initTabs(tablist) {
    var tabs = Array.prototype.slice.call(tablist.querySelectorAll('[role="tab"]'));
    var panels = tabs.map(function (tab) {
      return document.getElementById(tab.getAttribute('aria-controls'));
    });

    function loadLazyFrames(panel) {
      if (!panel) return;
      var frames = panel.querySelectorAll('iframe[data-src]');
      frames.forEach(function (frame) {
        if (!frame.getAttribute('src')) frame.setAttribute('src', frame.getAttribute('data-src'));
      });
    }

    function activate(index, focus) {
      tabs.forEach(function (tab, i) {
        var selected = i === index;
        tab.setAttribute('aria-selected', String(selected));
        tab.tabIndex = selected ? 0 : -1;
        if (panels[i]) panels[i].hidden = !selected;
      });
      loadLazyFrames(panels[index]);
      if (focus) tabs[index].focus();
    }

    tabs.forEach(function (tab, index) {
      tab.addEventListener('click', function () {
        activate(index, false);
        if (window.history && window.history.replaceState) {
          window.history.replaceState(null, '', '#' + tab.dataset.tab);
        }
      });
      tab.addEventListener('keydown', function (e) {
        var next = null;
        if (e.key === 'ArrowRight') next = (index + 1) % tabs.length;
        else if (e.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
        else if (e.key === 'Home') next = 0;
        else if (e.key === 'End') next = tabs.length - 1;
        if (next !== null) {
          e.preventDefault();
          activate(next, true);
        }
      });
    });

    var hash = window.location.hash.slice(1);
    if (hash) {
      var hashIndex = tabs.findIndex(function (tab) { return tab.dataset.tab === hash; });
      if (hashIndex > -1) activate(hashIndex, false);
    }

    var activeIndex = tabs.findIndex(function (tab) { return tab.getAttribute('aria-selected') === 'true'; });
    if (activeIndex > -1) loadLazyFrames(panels[activeIndex]);
  }

  document.querySelectorAll('[role="tablist"]').forEach(initTabs);
})();
