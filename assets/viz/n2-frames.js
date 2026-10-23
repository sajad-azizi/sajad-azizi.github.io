/* Coordinate guide for N₂. This illustrates the existing angle convention;
   it never modifies the payload, numerical core, or any plot's settings. */
(function () {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const RAD = Math.PI / 180;
  const COLORS = {molecule: '#52697f', polarization: '#087f8c', electron: '#cf632d', lab: '#7161b3', plane: '#e9eff4'};
  const EX = [1, 0, 0], EY = [0, 1, 0], EZ = [0, 0, 1];
  const scale = (v, s) => v.map(x => x * s);
  const add = (a, b) => a.map((x, i) => x + b[i]);
  const dot = (a, b) => a.reduce((sum, x, i) => sum + x * b[i], 0);
  const spherical = (polar, azimuth) => [Math.sin(polar) * Math.cos(azimuth), Math.sin(polar) * Math.sin(azimuth), Math.cos(polar)];

  function geometry(state) {
    const a = state.alpha * RAD, b = state.beta * RAD, g = state.gamma * RAD;
    const epsilon = spherical(b, a);
    const electron = spherical(state.theta * RAD, state.phi * RAD);
    const x0 = [Math.cos(b) * Math.cos(a), Math.cos(b) * Math.sin(a), -Math.sin(b)];
    const y0 = [-Math.sin(a), Math.cos(a), 0];
    const X = add(scale(x0, Math.cos(g)), scale(y0, Math.sin(g)));
    const Y = add(scale(x0, -Math.sin(g)), scale(y0, Math.cos(g)));
    // Columns [X,Y,epsilon] form Rz(alpha) Ry(beta) Rz(gamma).
    // Coordinates transform as v_mol = R v_lab, v_lab = R^T v_mol.
    return {epsilon, electron, x0, X, Y, toLab: v => [dot(X, v), dot(Y, v), dot(epsilon, v)]};
  }

  function svgElement(tag, attributes, text) {
    const node = document.createElementNS(NS, tag);
    Object.entries(attributes || {}).forEach(([key, value]) => node.setAttribute(key, String(value)));
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function html(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function makeDrawing(id, label) {
    const svg = svgElement('svg', {viewBox: '0 0 500 440', role: 'img', 'aria-labelledby': id + '-title ' + id + '-description', class: 'frame-drawing'});
    svg.appendChild(svgElement('title', {id: id + '-title'}, label));
    const description = svgElement('desc', {id: id + '-description'});
    svg.appendChild(description);
    const defs = svgElement('defs');
    for (const [key, color] of Object.entries(COLORS)) {
      const marker = svgElement('marker', {id: id + '-arrow-' + key, viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 5, markerHeight: 5, orient: 'auto-start-reverse'});
      marker.appendChild(svgElement('path', {d: 'M0 1 L9 5 L0 9 Z', fill: color}));
      defs.appendChild(marker);
    }
    const gradient = svgElement('radialGradient', {id: id + '-atom', cx: '30%', cy: '25%', r: '75%'});
    gradient.appendChild(svgElement('stop', {offset: '0', 'stop-color': '#fff'}));
    gradient.appendChild(svgElement('stop', {offset: '1', 'stop-color': '#bacbd9'}));
    defs.appendChild(gradient);
    svg.appendChild(defs);
    const stage = svgElement('g');
    svg.appendChild(stage);
    const az = 35 * RAD, el = 25 * RAD;
    function project(v) {
      return [250 + 122 * (Math.cos(az) * v[0] - Math.sin(az) * v[1]),
              265 + 122 * (Math.sin(az) * Math.sin(el) * v[0] + Math.cos(az) * Math.sin(el) * v[1] - Math.cos(el) * v[2])];
    }
    function line(a, b, color, options) {
      const p = project(a), q = project(b);
      const attrs = Object.assign({x1: p[0], y1: p[1], x2: q[0], y2: q[1], stroke: color, 'stroke-width': 1.5, 'stroke-linecap': 'round'}, options);
      stage.appendChild(svgElement('line', attrs));
    }
    function textAt(v, labelText, color, dx, dy, className) {
      const p = project(v);
      const node = svgElement('text', {x: p[0] + (dx || 0), y: p[1] + (dy || 0), fill: color, class: className || 'frame-axis-label', 'text-anchor': 'middle'}, labelText);
      stage.appendChild(node);
      // Keep labels inside the illustration as the vectors sweep a full sphere.
      const halfWidth = node.getComputedTextLength() / 2;
      node.setAttribute('x', Math.max(halfWidth + 10, Math.min(490 - halfWidth, p[0] + (dx || 0))));
      node.setAttribute('y', Math.max(24, Math.min(420, p[1] + (dy || 0))));
    }
    function arrow(v, key, labelText, offset) {
      line([0, 0, 0], v, COLORS[key], {'stroke-width': key === 'electron' || key === 'polarization' ? 3.5 : 2, 'marker-end': 'url(#' + id + '-arrow-' + key + ')'});
      if (labelText) textAt(v, labelText, COLORS[key], offset ? offset[0] : 0, offset ? offset[1] : -12);
    }
    function curve(points, key, labelText, labelPoint, offset) {
      const path = points.map((v, index) => (index ? 'L' : 'M') + project(v).map(x => x.toFixed(2)).join(' ')).join(' ');
      stage.appendChild(svgElement('path', {d: path, fill: 'none', stroke: COLORS[key], 'stroke-width': 2.2, 'marker-end': 'url(#' + id + '-arrow-' + key + ')'}));
      if (labelText) textAt(labelPoint, labelText, COLORS[key], offset ? offset[0] : 0, offset ? offset[1] : 0, 'frame-angle-label');
    }
    function arc(fn, end, radius, key, labelText, offset, start) {
      const from = start || 0;
      if (Math.abs(end - from) < 0.001) return;
      const points = Array.from({length: 65}, (_, i) => scale(fn(from + (end - from) * i / 64), radius));
      curve(points, key, labelText, scale(fn(from + (end - from) * 0.5), radius), offset);
    }
    function plane(x, y) {
      const points = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => project(add(scale(x, a * 1.25), scale(y, b * 1.25))).join(','));
      stage.appendChild(svgElement('polygon', {points: points.join(' '), fill: COLORS.plane, 'fill-opacity': .45, stroke: '#dbe5ec', 'stroke-width': 1}));
    }
    function molecule(z) {
      const a = scale(z, -.48), b = scale(z, .48);
      line(a, b, '#91a7b9', {'stroke-width': 9});
      for (const point of [a, b]) {
        const p = project(point);
        stage.appendChild(svgElement('circle', {cx: p[0], cy: p[1], r: 18, fill: 'url(#' + id + '-atom)', stroke: '#a5bbc9'}));
        textAt(point, 'N', '#3c596d', 0, 5, 'frame-atom-label');
      }
    }
    return {svg, description, stage, line, arrow, textAt, arc, plane, molecule};
  }

  function buildFrameGuide(root) {
    const state = {alpha: 30, beta: 50, gamma: 35, theta: 55, phi: 115};
    const initial = Object.assign({}, state);
    const legend = html('div', 'frame-legend');
    for (const [key, label] of [['molecule', 'Molecular axes · x, y, z'], ['polarization', 'Polarization · ε̂'], ['electron', 'Photoelectron · k̂'], ['lab', 'Laboratory axes · X, Y, Z']]) {
      const item = html('span', 'frame-legend-item', label);
      item.style.setProperty('--frame-color', COLORS[key]);
      legend.appendChild(item);
    }
    root.appendChild(legend);
    const pair = html('div', 'frame-pair');
    const drawings = [];
    for (const [id, title, subtitle] of [
      ['molecular-frame', 'Molecular frame', 'The N–N bond stays on z. Both directions are measured here.'],
      ['laboratory-frame', 'Laboratory frame', 'The polarization stays on Z. The molecule is tilted.']
    ]) {
      const figure = html('figure', 'frame-figure');
      const heading = html('figcaption', 'frame-caption');
      heading.appendChild(html('h3', '', title));
      heading.appendChild(html('p', '', subtitle));
      figure.appendChild(heading);
      const drawing = makeDrawing(id, title + ' coordinate diagram');
      figure.appendChild(drawing.svg);
      drawings.push(drawing);
      pair.appendChild(figure);
    }
    root.appendChild(pair);
    const hint = html('p', 'frame-live-note');
    hint.id = 'frame-angle-note';
    root.appendChild(hint);

    const controls = html('div', 'frame-control-groups');
    const handles = {};
    const specs = [
      {title: 'Electron direction', theme: 'electron', angles: [
        ['theta', 'ϑ', 'Polar angle', 'From molecular +z to the electron direction.', 180],
        ['phi', 'φ', 'Azimuth', 'From +x to the electron’s projection in the xy plane.', 360]]},
      {title: 'Polarization direction', theme: 'polarization', angles: [
        ['beta', 'β', 'Polar angle', 'From molecular +z to the polarization direction.', 180],
        ['alpha', 'α', 'Azimuth', 'From +x to the polarization’s projection in the xy plane.', 360]]},
      {title: 'Laboratory roll', theme: 'lab', angles: [
        ['gamma', 'γ', 'Roll about Z', 'Rotates X and Y around the polarization; Z stays fixed.', 360]]}
    ];
    for (const spec of specs) {
      const group = html('fieldset', 'frame-controls');
      group.style.setProperty('--frame-color', COLORS[spec.theme]);
      group.appendChild(html('legend', '', spec.title));
      for (const [key, symbol, title, explanation, max] of spec.angles) {
        const field = html('div', 'frame-control');
        const labelRow = html('div', 'frame-control-heading');
        const label = html('label');
        label.htmlFor = 'frame-' + key;
        label.appendChild(html('span', 'frame-control-symbol', symbol));
        label.appendChild(document.createTextNode(' ' + title));
        const output = html('output', 'frame-value');
        output.htmlFor = label.htmlFor;
        labelRow.append(label, output);
        const input = html('input');
        input.id = label.htmlFor;
        input.type = 'range'; input.min = '0'; input.max = String(max); input.step = '1';
        input.value = String(state[key]);
        const note = html('p', '', explanation);
        note.id = input.id + '-description';
        input.setAttribute('aria-describedby', note.id + ' frame-angle-note');
        field.append(labelRow, input, note);
        input.addEventListener('input', function () { state[key] = Number(input.value); render(); });
        handles[key] = {input, output};
        group.appendChild(field);
      }
      if (spec.theme === 'lab') group.appendChild(html('p', 'frame-roll-note', 'γ completes the frame. Only α and β enter the explorer’s polarization controls.'));
      controls.appendChild(group);
    }
    root.appendChild(controls);
    const toolbar = html('div', 'frame-toolbar');
    toolbar.appendChild(html('p', '', 'This guide is a geometric illustration. Each plot keeps its own angle settings.'));
    const reset = html('button', 'frame-reset', 'Reset illustration');
    reset.type = 'button';
    reset.addEventListener('click', function () { Object.assign(state, initial); render(); });
    toolbar.appendChild(reset);
    root.appendChild(toolbar);

    const convention = html('details', 'reading-guide frame-convention');
    convention.appendChild(html('summary', '', 'Angle convention & coordinate transformation'));
    convention.appendChild(html('p', '', 'The molecular axes are lowercase (x, y, z); laboratory axes are uppercase (X, Y, Z). The bond lies on z and linear polarization lies on Z. Here ϑ is the same polar angle called θ in the plots. All azimuths are right-handed, measured from +x toward +y.'));
    convention.appendChild(html('p', 'frame-formula', 'ε̂mol = (sin β cos α, sin β sin α, cos β)'));
    convention.appendChild(html('p', 'frame-formula', 'k̂mol = (sin ϑ cos φ, sin ϑ sin φ, cos ϑ)'));
    convention.appendChild(html('p', 'frame-formula', 'R = Rz(α) Ry(β) Rz(γ)     ·     vmol = R vlab'));
    convention.appendChild(html('p', '', 'The columns of R are the laboratory axes expressed in molecular coordinates. The inverse transformation is vlab = Rᵀ vmol. The dashed X₀ direction is the laboratory X axis at γ = 0. Increasing γ rotates X₀ toward X about Z; it is a coordinate-frame roll, not an extra polarization parameter.'));
    convention.appendChild(html('p', '', 'The photoelectron’s angles in the laboratory generally differ from ϑ and φ. Both panels show the same electron and polarization vectors expressed in different frames. Nitrogen atoms are schematic; orbital amplitudes and bond lengths are not encoded.'));
    root.appendChild(convention);

    function render() {
      for (const [key, handle] of Object.entries(handles)) {
        handle.input.value = String(state[key]);
        handle.input.setAttribute('aria-valuetext', state[key] + ' degrees');
        handle.output.value = state[key] + '°';
      }
      const g = geometry(state);
      const compact = window.innerWidth <= 700;
      const a = state.alpha * RAD, b = state.beta * RAD, theta = state.theta * RAD, phi = state.phi * RAD, gamma = state.gamma * RAD;
      const polarAxis = state.beta === 0 || state.beta === 180;
      const electronAxis = state.theta === 0 || state.theta === 180;
      const summary = 'α = ' + state.alpha + '°, β = ' + state.beta + '°, γ = ' + state.gamma + '°, ϑ = ' + state.theta + '°, φ = ' + state.phi + '°.';
      const mol = drawings[0];
      mol.stage.replaceChildren();
      mol.description.textContent = 'Nitrogen’s bond lies along molecular z. Teal polarization has polar angle β and azimuth α; orange electron emission has polar angle ϑ and azimuth φ. ' + summary;
      mol.plane(EX, EY);
      mol.arrow(scale(EX, 1.8), 'molecule', 'x', [12, 6]);
      mol.arrow(scale(EY, 1.8), 'molecule', 'y', [-12, 6]);
      mol.line(scale(EZ, -1.05), [0, 0, 0], '#9eb0bf', {'stroke-dasharray': '4 5'});
      mol.arrow(scale(EZ, 1.85), 'molecule', compact ? 'z' : 'z · N–N axis', [0, -14]);
      for (const [v, key] of [[g.epsilon, 'polarization'], [g.electron, 'electron']]) {
        const tip = scale(v, 1.95), projection = [tip[0], tip[1], 0];
        mol.line(tip, projection, COLORS[key], {'stroke-dasharray': '4 5', opacity: .6});
        mol.line([0, 0, 0], projection, COLORS[key], {'stroke-dasharray': '4 5', opacity: .6});
      }
      mol.molecule(EZ);
      // Polar arcs from +z; azimuth arcs are in the molecular xy plane.
      if (!polarAxis) mol.arc(t => [Math.cos(t), Math.sin(t), 0], a, .85, 'polarization', 'α', [10, 18]);
      if (!electronAxis) mol.arc(t => [Math.cos(t), Math.sin(t), 0], phi, 1.32, 'electron', 'φ', [0, 21]);
      mol.arc(t => spherical(t, a), b, 1.08, 'polarization', 'β', [17, -1]);
      mol.arc(t => spherical(t, phi), theta, .87, 'electron', 'ϑ', [-16, -5]);
      mol.arrow(scale(g.epsilon, 1.95), 'polarization', compact ? 'ε̂' : 'ε̂ · polarization', [28, -14]);
      mol.arrow(scale(g.electron, 1.95), 'electron', compact ? 'k̂' : 'k̂ · electron', [-10, -14]);

      const lab = drawings[1];
      lab.stage.replaceChildren();
      lab.description.textContent = 'The same event in the laboratory frame: Z is the polarization axis; the molecular z axis is tilted. γ rotates laboratory X and Y about Z from the dashed zero-roll direction X₀. ' + summary;
      lab.plane(EX, EY);
      lab.arrow(scale(EX, 1.8), 'lab', 'X', [12, 6]);
      lab.arrow(scale(EY, 1.8), 'lab', 'Y', [-12, 6]);
      lab.arrow(scale(EZ, 1.85), 'polarization', compact ? 'Z = ε̂' : 'Z = ε̂ · polarization', [0, -14]);
      const molZ = g.toLab(EZ);
      lab.line(scale(molZ, -1.0), [0, 0, 0], '#9eb0bf', {'stroke-dasharray': '4 5'});
      lab.molecule(molZ);
      lab.arrow(scale(molZ, 1.6), 'molecule', compact ? 'z' : 'z · N–N axis', [-18, -12]);
      lab.arrow(scale(g.toLab(g.electron), 1.95), 'electron', compact ? 'k̂' : 'k̂ · electron', [12, -14]);
      const x0Lab = g.toLab(g.x0);
      lab.line([0, 0, 0], scale(x0Lab, 1.65), COLORS.lab, {'stroke-dasharray': '4 5', opacity: .55});
      lab.textAt(scale(x0Lab, 1.65), 'X₀', COLORS.lab, 12, -8);
      lab.arc(t => [Math.cos(t), Math.sin(t), 0], 0, 1.12, 'lab', 'γ', [4, 23], -gamma);
      hint.textContent = 'ϑ (theta) and φ locate the electron; α and β locate the polarization. γ sets the transverse laboratory axes.'
        + (electronAxis ? ' At ϑ = ' + state.theta + '°, the electron lies on z and φ is undefined.' : '')
        + (polarAxis ? ' At β = ' + state.beta + '°, polarization lies on z and α does not change its direction.' : '');
    }
    render();
    return {state, render, section: root, geometry: () => geometry(state)};
  }

  window.EmolSections.buildFrameGuide = buildFrameGuide;
})();
