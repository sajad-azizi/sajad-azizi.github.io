/* Analytical illustration: D± = Y00 ± i η Y20, with η = 0.7.
 * The real spherical harmonics use their standard orthonormal normalization.
 * No dependencies, remote data, autoplay, or experimental claims.
 */
(function () {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var ETA = 0.7;
  var Y00 = 1 / Math.sqrt(4 * Math.PI);
  var Y20_FACTOR = Math.sqrt(5 / (16 * Math.PI));
  var MAX_YIELD = Y00 * Y00 * (1 + 5 * ETA * ETA);
  var SAMPLE_ANGLE = Math.PI / 4;
  var CENTER = { x: 215, y: 175 };
  var RADIUS = 135;
  var counter = 0;

  function model(theta, sign) {
    var cosine = Math.cos(theta);
    var imaginary = sign * ETA * Y20_FACTOR * (3 * cosine * cosine - 1);
    var derivative = -sign * ETA * Y20_FACTOR * 6 * cosine * Math.sin(theta);
    var intensity = Y00 * Y00 + imaginary * imaginary;
    return {
      yield: intensity,
      radius: intensity / MAX_YIELD,
      phase: Math.atan2(imaginary, Y00),
      gradient: Y00 * derivative / intensity
    };
  }

  function element(tag, attributes, content, svg) {
    var node = svg ? document.createElementNS(SVG_NS, tag) : document.createElement(tag);
    Object.keys(attributes || {}).forEach(function (key) {
      node.setAttribute(key, attributes[key]);
    });
    if (content !== undefined) node.textContent = content;
    return node;
  }

  function svgElement(tag, attributes, content) {
    return element(tag, attributes, content, true);
  }

  function signed(value) {
    return (value < 0 ? '−' : '+') + Math.abs(value).toFixed(2);
  }

  function phaseColor(phase) {
    var middle = [36, 59, 74];
    var end = phase < 0 ? [16, 125, 127] : [181, 101, 58];
    var fraction = Math.min(1, Math.abs(phase) / (Math.PI / 2));
    return 'rgb(' + middle.map(function (channel, index) {
      return Math.round(channel + (end[index] - channel) * fraction);
    }).join(',') + ')';
  }

  function point(theta) {
    var radius = RADIUS * model(theta, 1).radius;
    return [CENTER.x + radius * Math.sin(theta), CENTER.y - radius * Math.cos(theta)];
  }

  function pair(coordinates) {
    return coordinates.map(function (value) { return value.toFixed(3); }).join(' ');
  }

  function mount(container) {
    if (container.dataset.phaseReady === 'true') return;
    var prefix = 'phase-portrait-' + (++counter);
    var fragment = document.createDocumentFragment();
    var top = element('div', { class: 'phase-portrait__top' });
    var heading = element('p', { class: 'phase-portrait__eyebrow' }, 'An angular phase model');
    var controls = element('div', { class: 'phase-portrait__controls', role: 'group', 'aria-label': 'Choose the model wave' });
    var buttons = [1, -1].map(function (sign) {
      var button = element('button', {
        type: 'button',
        class: 'phase-portrait__button',
        'aria-pressed': String(sign === 1),
        'aria-label': sign === 1 ? 'Show wave D plus' : 'Show wave D minus'
      }, sign === 1 ? 'D⁺' : 'D⁻');
      controls.appendChild(button);
      return button;
    });
    top.append(heading, controls);
    fragment.appendChild(top);

    var svg = svgElement('svg', {
      class: 'phase-portrait__plot', viewBox: '0 0 430 350', role: 'img',
      'aria-labelledby': prefix + '-title ' + prefix + '-description'
    });
    var title = svgElement('title', { id: prefix + '-title' }, 'Two electron waves with the same angular yield');
    var description = svgElement('desc', { id: prefix + '-description' });
    svg.append(title, description);

    var grid = svgElement('g', { class: 'phase-portrait__grid', 'aria-hidden': 'true' });
    [0.5, 1].forEach(function (fraction) {
      grid.appendChild(svgElement('circle', { cx: CENTER.x, cy: CENTER.y, r: RADIUS * fraction }));
    });
    grid.appendChild(svgElement('path', { d: 'M 215 25 V 325 M 65 175 H 365' }));
    svg.appendChild(grid);

    var outline = [];
    var segments = [];
    var segmentCount = 360;
    var wave = svgElement('g', { 'aria-hidden': 'true' });
    for (var i = 0; i <= segmentCount; i += 1) {
      outline.push((i === 0 ? 'M ' : 'L ') + pair(point(i * Math.PI * 2 / segmentCount)));
    }
    wave.appendChild(svgElement('path', { d: outline.join(' ') + ' Z', class: 'phase-portrait__fill' }));
    for (var index = 0; index < segmentCount; index += 1) {
      var theta = index * Math.PI * 2 / segmentCount;
      var path = svgElement('path', {
        d: 'M ' + pair(point(theta)) + ' L ' + pair(point((index + 1) * Math.PI * 2 / segmentCount)),
        fill: 'none', 'stroke-width': '6', 'stroke-linecap': 'round'
      });
      segments.push({ node: path, theta: theta + Math.PI / segmentCount });
      wave.appendChild(path);
    }
    svg.appendChild(wave);

    var annotation = svgElement('g', { class: 'phase-portrait__annotation', 'aria-hidden': 'true' });
    annotation.appendChild(svgElement('path', { d: 'M 215 175 L 317 73', class: 'phase-portrait__ray' }));
    annotation.appendChild(svgElement('path', { d: 'M 215 144 A 31 31 0 0 1 236.92 153.08', class: 'phase-portrait__angle' }));
    var selectedPoint = point(SAMPLE_ANGLE);
    annotation.appendChild(svgElement('circle', { cx: selectedPoint[0], cy: selectedPoint[1], r: '4.5', class: 'phase-portrait__point' }));
    annotation.appendChild(svgElement('circle', { cx: CENTER.x, cy: CENTER.y, r: '2.5', class: 'phase-portrait__origin' }));
    annotation.appendChild(svgElement('text', { x: '226', y: '20', class: 'phase-portrait__axis' }, 'z'));
    annotation.appendChild(svgElement('text', { x: '371', y: '180', class: 'phase-portrait__axis' }, 'x'));
    annotation.appendChild(svgElement('text', { x: '320', y: '68', class: 'phase-portrait__angle-label' }, 'ϑ = 45°'));
    svg.appendChild(annotation);
    fragment.appendChild(svg);

    var legend = element('div', { class: 'phase-portrait__legend' });
    legend.appendChild(element('p', {}, 'Radius: normalized yield · Color: phase'));
    var scale = element('div', { class: 'phase-portrait__scale', 'aria-label': 'Phase scale: teal is negative, navy is zero, copper is positive' });
    scale.appendChild(element('div', { class: 'phase-portrait__colorbar', 'aria-hidden': 'true' }));
    var ticks = element('div', { class: 'phase-portrait__ticks', 'aria-hidden': 'true' });
    ['−π/2', '0', '+π/2'].forEach(function (tick) { ticks.appendChild(element('span', {}, tick)); });
    scale.appendChild(ticks);
    legend.appendChild(scale);
    fragment.appendChild(legend);

    var result = element('div', { class: 'phase-portrait__result' });
    var resultLabel = element('span', {}, 'Angular phase gradient at 45°');
    var resultValue = element('span', { class: 'phase-portrait__value' });
    result.append(resultLabel, resultValue);
    fragment.appendChild(result);
    var status = element('p', { class: 'phase-portrait__sr-only', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
    fragment.appendChild(status);

    var caption = element('p', { class: 'phase-portrait__caption' }, 'Same yield and EWS delay. Opposite angular phase gradients.');
    fragment.appendChild(caption);
    var details = element('details', { class: 'phase-portrait__details' });
    details.appendChild(element('summary', {}, 'About this model'));
    details.appendChild(element('p', { class: 'phase-portrait__formula' }, 'D±(ϑ) = Y₀₀ ± 0.7i Y₂₀(ϑ)'));
    details.appendChild(element('p', {}, 'An analytical illustration, not measured data. The polar slice shows the standard real spherical harmonics with m = 0; the wave is independent of azimuth. The radial scale is |D|² divided by its maximum, and color is arg D in radians.'));
    details.appendChild(element('p', {}, 'The plotted angular factors are energy independent, so both have zero EWS delay. A shared factor A(E) exp[iφ₀(E)], with A real and positive, gives both the same EWS delay ℏ∂Eφ₀. It leaves their opposite angular phase gradients unchanged.'));
    fragment.appendChild(details);

    function select(sign, announce) {
      buttons.forEach(function (button, buttonIndex) {
        button.setAttribute('aria-pressed', String((buttonIndex === 0 ? 1 : -1) === sign));
      });
      segments.forEach(function (segment) {
        segment.node.setAttribute('stroke', phaseColor(model(segment.theta, sign).phase));
      });
      var sample = model(SAMPLE_ANGLE, sign);
      resultValue.textContent = signed(sample.gradient) + ' rad/rad';
      description.textContent = 'Analytical wave D ' + (sign === 1 ? 'plus' : 'minus') +
        '. Radius is normalized angular yield; color is phase, from teal for negative through navy for zero to copper for positive. ' +
        'At a polar angle of 45 degrees, the angular phase gradient is ' + signed(sample.gradient) +
        ' radians per radian. Both choices have identical yields and EWS delays; their angular phase gradients have opposite signs.';
      if (announce) status.textContent = 'Wave D ' + (sign === 1 ? 'plus' : 'minus') +
        ' selected. Angular phase gradient at 45 degrees: ' + signed(sample.gradient) +
        ' radians per radian. The yield contour is unchanged.';
      container.dataset.phaseWave = sign === 1 ? 'plus' : 'minus';
    }

    buttons.forEach(function (button, index) {
      button.addEventListener('click', function () { select(index === 0 ? 1 : -1, true); });
    });
    select(1, false);
    container.replaceChildren(fragment);
    container.dataset.phaseReady = 'true';
  }

  function initialize() {
    document.querySelectorAll('[data-phase-portrait]').forEach(mount);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
}());
