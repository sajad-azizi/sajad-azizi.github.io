(function () {
  'use strict';

  var frame = document.getElementById('n2-explorer');
  if (!frame) return;

  // The explorer reports its content height so the page has one scroll area.
  window.addEventListener('message', function (event) {
    if (event.source !== frame.contentWindow || event.origin !== window.location.origin) return;
    var message = event.data;
    if (!message || message.type !== 'emol:n2:resize') return;
    if (typeof message.height !== 'number' || !Number.isFinite(message.height)) return;

    var height = Math.min(10000, Math.max(600, Math.ceil(message.height)));
    if (frame.style.height !== height + 'px') frame.style.height = height + 'px';
  });
})();
