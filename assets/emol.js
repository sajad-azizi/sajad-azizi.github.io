(function () {
  'use strict';

  var frames = Object.create(null);
  frames['emol:n2:resize'] = document.getElementById('n2-explorer');
  frames['emol:h2o:resize'] = document.getElementById('h2o-explorer');

  // Each explorer reports its content height so the page has one scroll area.
  window.addEventListener('message', function (event) {
    if (event.origin !== window.location.origin) return;
    var message = event.data;
    if (!message || typeof message.type !== 'string') return;
    var frame = frames[message.type];
    if (!frame || event.source !== frame.contentWindow) return;
    if (typeof message.height !== 'number' || !Number.isFinite(message.height)) return;

    var height = Math.min(10000, Math.max(600, Math.ceil(message.height)));
    if (frame.style.height !== height + 'px') frame.style.height = height + 'px';
  });
})();
