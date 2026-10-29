/* NO paper comparison and discrete-sample molecular explorer. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const RAD = Math.PI / 180;
  const COLORS = {emol: '#117c7d', measured: '#334b64', theory: '#cb8652', reference: '#8d739d', b: '#137f80', c: '#b66d45', X: '#6676a3'};
  const LABELS = {b: 'b ³Π', c: 'c ³Π', X: 'X ¹Σ⁺'};
  const DATA_REVISION = '20261029-no-angular-delays';
  const sampleLabel = order => order % 2 === 0 ? 'SB' + order : 'Photon index ' + order;
  const CONFIG = {responsive: false, displaylogo: false, scrollZoom: false, modeBarButtonsToRemove: ['select2d', 'lasso2d', 'autoScale2d'], toImageButtonOptions: {format: 'png', scale: 2}};
  const built = new Set();
  let active = 'paper', amplitudePromise, frameGuide, resizeTimer;
  const embedded = window.parent !== window;
  if (embedded) document.body.classList.add('is-embedded');

  function node(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function report(error) {
    console.error(error);
    $('page-error').hidden = false;
    $('page-error').textContent = 'This view could not be loaded. ' + (error.message || String(error));
    postHeight();
  }
  function guarded(fn) { return (...args) => Promise.resolve().then(() => fn(...args)).catch(report); }
  function postHeight() {
    if (!embedded) return;
    const footer = document.querySelector('.explorer-footer');
    const height = Math.ceil(footer.getBoundingClientRect().bottom + window.scrollY + 8);
    window.parent.postMessage({type: 'emol:no:resize', height}, location.protocol === 'file:' ? '*' : location.origin);
  }
  function layout(extra = {}) {
    return Object.assign({height: 390, margin: {l: 60, r: 22, t: 25, b: 55}, paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: '#fff', font: {family: '-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif', color: '#496174', size: 11}, showlegend: false, hovermode: 'closest', xaxis: {gridcolor: '#eaf0f3', zeroline: false, title: 'Photon energy (eV)'}, yaxis: {gridcolor: '#eaf0f3', zerolinecolor: '#b9c9d1'}}, extra);
  }
  async function plot(target, traces, options) {
    await Plotly.react(target, traces, layout(options), CONFIG);
    target.setAttribute('role', 'img');
    if (!target.hasAttribute('aria-label')) target.setAttribute('aria-label', target.closest('section').querySelector('h2').textContent + ' · interactive calculation plot');
    postHeight();
  }
  function select(parent, label, options, value, change) {
    const wrap = node('label', 'emol-control');
    wrap.append(node('span', 'emol-label', label));
    const input = node('select', 'emol-select');
    input.setAttribute('aria-label', label);
    for (const [key, text] of options) { const o = node('option', '', text); o.value = key; input.append(o); }
    input.value = value;
    input.addEventListener('change', guarded(() => change(input.value)));
    wrap.append(input); parent.append(wrap);
    return input;
  }
  function range(parent, label, value, max, change) {
    const wrap = node('label', 'emol-control');
    const row = node('span', 'emol-control-row');
    row.append(node('span', 'emol-label', label));
    const out = node('output', 'emol-readout', value + '°'); row.append(out);
    const input = node('input', 'emol-range');
    input.type = 'range'; input.min = 0; input.max = max; input.step = 5; input.value = value;
    input.setAttribute('aria-label', label); input.setAttribute('aria-valuetext', value + ' degrees');
    input.addEventListener('input', () => { out.value = input.value + '°'; input.setAttribute('aria-valuetext', input.value + ' degrees'); });
    input.addEventListener('change', guarded(() => change(Number(input.value))));
    wrap.append(row, input); parent.append(wrap); return input;
  }
  function energySlider(parent, id, change) {
    const wrap = node('div', 'no-energy-control');
    const header = node('div', 'no-energy-header');
    const label = node('label', 'emol-label', 'Electron energy'); label.htmlFor = id;
    const readout = node('output', 'no-energy-readout');
    readout.htmlFor = id; readout.setAttribute('aria-live', 'off');
    header.append(label, readout);
    const meta = node('div', 'no-energy-meta');
    const photon = node('span'), counter = node('span'); meta.append(photon, counter);
    const track = node('div', 'no-energy-track');
    const previous = node('button', 'no-button no-energy-step', '←');
    const next = node('button', 'no-button no-energy-step', '→');
    previous.type = next.type = 'button';
    previous.setAttribute('aria-label', 'Previous calculated energy'); previous.title = 'Previous calculated energy';
    next.setAttribute('aria-label', 'Next calculated energy'); next.title = 'Next calculated energy';
    const input = node('input', 'emol-range');
    input.id = id; input.type = 'range'; input.min = 0; input.step = 1;
    const extents = node('div', 'no-energy-extents');
    const minimum = node('span'), maximum = node('span'); extents.append(minimum, maximum);
    extents.setAttribute('aria-hidden', 'true');
    const hint = node('p', 'no-energy-hint', 'Calculated energies only · no interpolation.');
    hint.id = id + '-hint'; input.setAttribute('aria-describedby', hint.id);
    const announcement = node('span', 'no-energy-announcement');
    announcement.setAttribute('role', 'status'); announcement.setAttribute('aria-atomic', 'true');
    track.append(previous, input, next); wrap.append(header, meta, track, extents, hint, announcement);
    parent.prepend(wrap);
    let samples = [], index = 0;
    function update() {
      const p = samples[index];
      input.value = index;
      readout.value = p.energy_ev.toFixed(4) + ' eV';
      photon.textContent = 'Photon energy ' + p.photon_ev.toFixed(4) + ' eV';
      counter.textContent = 'Point ' + (index + 1) + ' of ' + samples.length;
      input.setAttribute('aria-valuetext', p.energy_ev.toFixed(4) + ' electron volts, point ' + (index + 1) + ' of ' + samples.length);
      previous.disabled = index === 0;
      next.disabled = index === samples.length - 1;
    }
    function move(value, announce = false) {
      index = Math.max(0, Math.min(samples.length - 1, value));
      update();
      // Native range changes announce aria-valuetext. Buttons need their own
      // announcement, without making every pointer movement a live update.
      announcement.textContent = announce ? input.getAttribute('aria-valuetext') : '';
      return change(index);
    }
    input.addEventListener('input', guarded(() => move(Number(input.value))));
    previous.addEventListener('click', guarded(() => move(index - 1, true)));
    next.addEventListener('click', guarded(() => move(index + 1, true)));
    return {
      set(points, selected) {
        samples = points; index = selected;
        input.max = samples.length - 1; input.disabled = samples.length < 2;
        minimum.textContent = samples[0].energy_ev.toFixed(2) + ' eV';
        maximum.textContent = samples[samples.length - 1].energy_ev.toFixed(2) + ' eV';
        update();
      }
    };
  }
  function fieldset(parent, title) { const f = node('fieldset'); f.append(node('legend', '', title)); parent.append(f); return f; }
  function note(parent, text, cls = 'no-plot-note') { const p = node('p', cls, text); parent.append(p); return p; }
  function workbench(root) {
    root.replaceChildren();
    const body = node('div', 'no-workbench'), settings = node('div', 'no-settings'), results = node('div', 'no-results');
    const context = node('p', 'no-context'), chart = node('div', 'no-plot');
    results.append(context, chart); body.append(settings, results); root.append(body);
    return {body, settings, results, context, chart};
  }
  function channelOptions(all = false) { return [...(all ? [['all', 'All three channels']] : []), ...Object.entries(LABELS)]; }
  function angleLink(parent) { const b = node('button', 'no-angle-link', 'Understand α, β, γ, ϑ and φ →'); b.type = 'button'; b.addEventListener('click', guarded(() => activate('frames', true))); parent.append(b); }
  function paperTrace(rows, key, name, color, symbol, extra = {}) {
    return Object.assign({type: 'scatter', mode: 'markers', name, x: rows.map(p => p.photon), y: rows.map(p => p[key]), marker: {color, symbol, size: 9, line: {width: 1.5, color}}, hovertemplate: name + '<br>%{x:.3f} eV<br>%{y:.2f} as<extra></extra>'}, extra);
  }
  function sampleLine(trace) {
    const spacing = trace.x.slice(1).map((x, i) => x - trace.x[i]).filter(d => d > 0);
    const step = Math.min(...spacing);
    const indices = [];
    trace.x.forEach((x, i) => {
      if (i && x - trace.x[i - 1] > 1.5 * step) indices.push(null);
      indices.push(i);
    });
    const join = values => indices.map(i => i === null ? null : values[i]);
    const result = {...trace, mode: 'lines+markers', connectgaps: false,
      line: {color: trace.marker.color, width: 1.5, ...trace.line}, x: join(trace.x), y: join(trace.y)};
    if (trace.customdata) result.customdata = join(trace.customdata);
    if (Array.isArray(trace.marker.symbol)) result.marker = {...trace.marker, symbol: indices.map(i => i === null ? 'circle' : trace.marker.symbol[i])};
    return result;
  }
  function theoryTraces(rows) {
    // Keep digitized reconstruction intervals visible; no smoothing or fitted shift.
    return ['local', 'bridged'].map(flag => {
      const x = [], y = []; let inRun = false;
      for (let i = 1; i < rows.length; i++) {
        const segmentFlag = rows[i - 1].flag === 'bridged' || rows[i].flag === 'bridged' ? 'bridged' : 'local';
        if (segmentFlag === flag) {
          if (!inRun) { x.push(rows[i - 1].photon); y.push(rows[i - 1].value); }
          x.push(rows[i].photon); y.push(rows[i].value); inRun = true;
        } else if (inRun) { x.push(null); y.push(null); inRun = false; }
      }
      return {type: 'scatter', mode: 'lines', name: flag === 'local' ? 'Paper theory · digitized' : 'Paper theory · bridged interval', x, y, connectgaps: false, line: {color: COLORS.theory, width: 2, dash: flag === 'bridged' ? 'dot' : 'solid'}, hovertemplate: 'Digitized theory' + (flag === 'bridged' ? ' · reconstructed' : '') + '<br>%{x:.2f} eV<br>%{y:.2f} as<extra></extra>'};
    });
  }
  function downloadPaper(data) {
    const head = ['channel_difference', 'photon_energy_index', 'sample_kind', 'photon_energy_eV', 'full_xyz_delay_as', 'y_omitted_diagnostic_as', 'all_directions_4pi_as', 'near_K_pole', 'route', 'origin'];
    const rows = [head, ...['b', 'c'].flatMap(ch => data.comparisons[ch].emol.map(p => [ch + '-X', p.order, p.is_paper_sideband ? 'sideband' : 'interleaved_calculation', p.photon, p.complete, p.omitted, p.fourpi, p.at_pole, p.route, 'expansion']))];
    const url = URL.createObjectURL(new Blob([rows.map(r => r.join(',')).join('\n') + '\n'], {type: 'text/csv;charset=utf-8'}));
    const a = node('a'); a.href = url; a.download = 'NO-Fig3-eMOL-' + data.meta.snapshot + '.csv'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function buildPaper() {
    const data = window.NO_PAPER_DATA, root = $('paper-root'); root.replaceChildren();
    const state = {convention: 'omitted', measured: true, theory: true, reference: true, emol: true};
    const heading = node('div', 'no-figure-heading');
    heading.append(node('h3', '', 'Figure 3 · Relative two-photon delays'), node('p', '', 'Positive values are delays relative to X; negative values are advances. The y-omitted diagnostic is selected initially.'));
    root.append(heading);
    const toolbar = node('div', 'paper-toolbar'); root.append(toolbar);
    select(toolbar, 'Figure 3 · detection & calculation convention', [['omitted', 'Diagnostic · XUV y component omitted'], ['complete', 'Along polarization · full x, y, z'], ['fourpi', 'All electron directions · 4π collection']], state.convention, value => { state.convention = value; return draw(); });
    const download = node('button', 'no-button', 'Download eMOL points ↓'); download.type = 'button'; download.addEventListener('click', () => downloadPaper(data)); toolbar.append(download);
    const legend = node('div', 'paper-legend'); legend.setAttribute('aria-label', 'Show comparison datasets'); root.append(legend);
    const legendControls = {};
    for (const [key, label, glyph] of [['measured', 'Experiment · digitized', '●'], ['theory', 'Paper theory · digitized', '━'], ['reference', 'Independent ePolyScat + cc', '△'], ['emol', 'eMOL · full two-photon', '◆']]) {
      const l = node('label'), input = node('input'); input.type = 'checkbox'; input.checked = state[key]; input.addEventListener('change', guarded(() => { state[key] = input.checked; return draw(); }));
      const swatch = node('span', 'legend-glyph', glyph); swatch.style.color = COLORS[key]; swatch.setAttribute('aria-hidden', 'true');
      l.append(input, swatch, node('span', '', label)); legend.append(l); legendControls[key] = {input, label: l};
    }
    const geometry = note(root, '', 'no-context'), diagnostic = note(root, '', 'no-state-note');
    const pair = node('div', 'no-chart-pair'); root.append(pair); const charts = {};
    for (const ch of ['b', 'c']) {
      const card = node('div', 'no-chart-card'), caption = node('div', 'no-chart-caption');
      caption.append(node('h3', '', LABELS[ch] + ' − ' + LABELS.X), node('span', '', 'Figure 3' + (ch === 'b' ? 'a' : 'b')));
      charts[ch] = node('div', 'no-plot'); charts[ch].setAttribute('aria-label', 'Relative delay ' + ch + ' minus X versus photon energy');
      card.append(caption, charts[ch]); pair.append(card);
    }
    const poleLabels = ['b', 'c'].flatMap(ch => data.comparisons[ch].emol.filter(p => p.at_pole).map(p => ch + ' ' + sampleLabel(p.order)));
    note(root, '◆ Filled diamonds: eMOL. ◇ Hollow diamonds: near-pole centre runs' + (poleLabels.length ? ' (' + poleLabels.join('; ') + ')' : '') + '. Lines join adjacent calculated samples. Experimental bars are digitized 1σ uncertainties. Dotted theory segments reconstruct parts obscured by markers.');
    const intermediateCount = ['b', 'c'].reduce((n, ch) => n + data.comparisons[ch].emol.filter(p => !p.is_paper_sideband).length, 0);
    if (intermediateCount) note(root, intermediateCount + ' additional comparison points sample intermediate photon energies. These are calculations; the experimental points remain those digitized from the paper.');
    const fig4 = node('div', 'no-fig4'); fig4.id = 'fig4-root'; root.append(fig4);
    const interpretation = node('div', 'no-interpretation');
    for (const [title, text] of [['What is being tested', 'The electronic-state delay differences at a fixed N–O separation of 1.15 Å. The calculation uses randomly oriented molecules and an 800 nm probe.'], ['What the comparison shows', 'The published theory is not fully reproduced by the present calculations. Agreement between eMOL and the independent calculation is useful evidence, but does not resolve the remaining differences with the paper.']]) { const card = node('div'); card.append(node('h3', '', title), node('p', '', text)); interpretation.append(card); }
    root.append(interpretation);
    const methods = node('details', 'reading-guide no-methods'); methods.append(node('summary', '', 'How to read this comparison · methods & limitations'));
    for (const text of data.methodnotes) note(methods, text, '');
    note(methods, 'The paper’s time-of-flight detector is approximately aligned with the polarization; the displayed along-polarization calculation uses the ideal direction. This is the electronic-state comparison in Figure 3, not the vibrationally resolved comparison in Figure 5.', '');
    root.append(methods);
    const comparisonCount = ['b', 'c'].reduce((n, ch) => n + data.comparisons[ch].emol.length, 0);
    const tableDetails = node('details', 'reading-guide'); tableDetails.append(node('summary', '', 'Inspect the ' + comparisonCount + ' eMOL comparison points'));
    const wrap = node('div', 'no-table-wrap'), table = node('table', 'no-table');
    const tr = node('tr'); for (const title of ['Difference / sample', 'Photon / eV', 'Full XYZ / as', 'Y omitted / as', '4π / as', 'Route']) tr.append(node('th', '', title));
    const thead = node('thead'); thead.append(tr); table.append(thead); const tbody = node('tbody');
    for (const ch of ['b', 'c']) for (const p of data.comparisons[ch].emol) { const r = node('tr'); for (const value of [ch + '−X / ' + sampleLabel(p.order) + (p.at_pole ? ' ◇' : ''), p.photon.toFixed(4), p.complete.toFixed(2), p.omitted.toFixed(2), p.fourpi.toFixed(2), p.route]) r.append(node('td', '', value)); tbody.append(r); }
    table.append(tbody); wrap.append(table); tableDetails.append(wrap); root.append(tableDetails);
    async function draw() {
      const fourpi = state.convention === 'fourpi';
      geometry.textContent = fourpi ? 'Random molecular orientation · parallel XUV/IR · all electron directions collected (4π) · 800 nm' : 'Random molecular orientation · parallel XUV/IR · electron detected along polarization · 800 nm';
      diagnostic.hidden = state.convention === 'complete';
      diagnostic.textContent = fourpi ? 'Different detection geometry: only eMOL is shown. The Figure 3 experiment, published theory and independent reference do not provide this 4π comparison.' : 'Diagnostic selection: omitting the XUV y component changes the response. The experimental points and published curve remain the Figure 3 references; they are not recalculated for this selection.';
      for (const key of ['measured', 'theory', 'reference']) { legendControls[key].input.disabled = fourpi; legendControls[key].label.style.opacity = fourpi ? '.4' : '1'; }
      await Promise.all(['b', 'c'].map(ch => {
        const comp = data.comparisons[ch], traces = [];
        if (!fourpi && state.theory) traces.push(...theoryTraces(comp.theory));
        if (!fourpi && state.measured) traces.push(paperTrace(comp.measured, 'value', 'Experiment · digitized', COLORS.measured, 'circle', {error_y: {type: 'data', symmetric: false, array: comp.measured.map(p => p.err_up), arrayminus: comp.measured.map(p => p.err_down), color: COLORS.measured, thickness: 1.2, width: 3}, marker: {color: COLORS.measured, size: 7}}));
        if (!fourpi && state.reference) traces.push(sampleLine(paperTrace(comp.reference, state.convention, 'Independent ePolyScat + cc', COLORS.reference, 'triangle-up-open', {marker: {color: COLORS.reference, symbol: 'triangle-up-open', size: 12, line: {width: 1.5, color: COLORS.reference}}})));
        if (state.emol) traces.push(sampleLine(paperTrace(comp.emol, state.convention, 'eMOL', COLORS.emol, 'diamond', {marker: {color: COLORS.emol, size: comp.emol.length > 12 ? 8 : 10, symbol: comp.emol.map(p => p.at_pole ? 'diamond-open' : 'diamond'), line: {width: 1.8, color: COLORS.emol}}, customdata: comp.emol.map(p => [sampleLabel(p.order), p.route + (p.at_pole ? ' · near K pole' : '') + (!p.is_paper_sideband ? ' · interleaved calculation' : '')]), hovertemplate: 'eMOL · %{customdata[0]}<br>%{x:.4f} eV · %{y:.2f} as<br>%{customdata[1]}<extra></extra>'})));
        return plot(charts[ch], traces, {height: 370, margin: {l: 57, r: 15, t: 20, b: 52}, xaxis: {title: 'Sideband photon energy (eV)', range: ch === 'b' ? [26.5, 45] : [33, 45], gridcolor: '#eaf0f3', zeroline: false, dtick: 3}, yaxis: {title: 'Relative delay (as)', range: [-140, 140], tickvals: [-120, -60, 0, 60, 120], gridcolor: '#eaf0f3', zerolinecolor: '#bccbd3'}});
      }));
    }
    await draw();
    await buildFigure4(fig4);
  }

  async function buildFigure4(root) {
    const data = window.NO_FIG4_DATA;
    if (!data) throw new Error('The Figure 4 dataset could not be loaded.');
    const state = {convention: 'omitted', scale: 'paper', channels: {X: true, b: true, A: true, c: true}};
    const channelColors = {X: '#bc5554', b: '#486aba', A: '#c49b36', c: '#198b80'};
    const labels = {...LABELS, A: 'A ¹Π'};
    const heading = node('div', 'no-figure-heading');
    heading.append(node('h3', '', 'Figure 4 · Cross sections & Wigner delays'), node('p', '', 'Four ionic channels at a fixed N–O separation of 1.15 Å. These one-photon observables are distinct from the two-photon delays above.'));
    root.append(heading);
    const toolbar = node('div', 'paper-toolbar'); root.append(toolbar);
    select(toolbar, 'Figure 4 · polarization components', [['omitted', 'Diagnostic · XUV y component omitted'], ['complete', 'Full x, y, z components']], state.convention, v => { state.convention = v; return draw(); });
    select(toolbar, 'Figure 4a · cross-section normalization', [['paper', 'Paper ordinate vs 4π-scaled calculations'], ['physical', 'Physical differential cross section · Mb/sr']], state.scale, v => { state.scale = v; return draw(); });
    const legend = node('div', 'paper-legend no-channel-legend'); legend.setAttribute('aria-label', 'Figure 4 ionic channels'); root.append(legend);
    for (const ch of ['X', 'b', 'A', 'c']) {
      const label = node('label'), input = node('input'); input.type = 'checkbox'; input.checked = true;
      input.addEventListener('change', guarded(() => { state.channels[ch] = input.checked; return draw(); }));
      const glyph = node('span', 'legend-glyph', '━'); glyph.style.color = channelColors[ch]; glyph.setAttribute('aria-hidden', 'true');
      label.append(input, glyph, node('span', '', labels[ch])); legend.append(label);
    }
    const sources = node('div', 'no-dataset-legend');
    for (const [cls, glyph, label] of [['no-dataset-line', '', 'Paper · digitized'], ['no-dataset-line dashed', '', 'Independent ePolyScat'], ['no-dataset-point', '○', 'Reference fine checkpoints'], ['no-dataset-point', '◆', 'eMOL cross sections']]) {
      const item = node('span'), swatch = node('i', cls, glyph); swatch.setAttribute('aria-hidden', 'true'); item.append(swatch, node('span', '', label)); sources.append(item);
    }
    root.append(sources);
    const convention = note(root, '', 'no-context');
    const pair = node('div', 'no-chart-pair'); root.append(pair); const charts = {};
    for (const [key, title, panel] of [['sigma', 'Photoionization cross section', 'Figure 4a'], ['delay', 'One-photon Wigner delay', 'Figure 4b']]) {
      const card = node('div', 'no-chart-card'), caption = node('div', 'no-chart-caption');
      caption.append(node('h3', '', title), node('span', '', panel)); charts[key] = node('div', 'no-plot'); charts[key].id = 'fig4-' + key;
      charts[key].setAttribute('aria-label', title + ' versus photon energy, comparing ionic channels in Figure 4');
      card.append(caption, charts[key]); pair.append(card);
    }
    note(root, 'eMOL cross sections are available for b, c and X. A is shown from the paper and independent calculation. No eMOL Wigner curve is overlaid: the available stored delay averages do not provide a validated match to Figure 4’s detection geometry.');
    note(root, 'Paper curves retain their digitization gaps; dotted segments mark reconstructed intervals. Fine-checkpoint circles identify local energy derivatives in the independent calculation; they do not establish convergence of the entire coarse curve. Hollow eMOL diamonds identify box-route samples; lines join adjacent calculations.');
    const details = node('details', 'reading-guide no-methods'); details.append(node('summary', '', 'Figure 4 · normalization, delay definition & sources'));
    note(details, 'Figure 4a’s caption describes a total cross section, while its axis and differential definition specify Mb/sr. The independent review found that an explicit factor 4π and omission of the y component bring the numerical curves closer to the published ordinate. These are diagnostic choices, not a fitted scale or an established account of the authors’ processing.', '');
    note(details, 'In the default ordinate comparison, the paper retains its digitized numbers, labelled Mb/sr in the original figure, while calculations show 4π × dσ/dΩ in Mb. The axis therefore compares numerical ordinates with different normalizations. Select physical differential cross section for Mb/sr throughout; the incompatible paper cross-section trace is then hidden. Wigner delays are unaffected by this normalization control.', '');
    note(details, 'The Wigner curves show random-orientation, along-polarization one-photon phase derivatives from the paper and independent reference. No continuum–continuum correction is added. The y-omitted selection applies to the reference calculation; the digitized paper curves stay unchanged.', '');
    root.append(details);
    function paperLines(rows, ch, delay) {
      // Do not connect missing digitization intervals or turn reconstructions
      // into solid, apparently measured portions of the published curve.
      return ['local', 'bridged'].map(flag => {
        const x = [], y = []; let inRun = false;
        for (let i = 1; i < rows.length; i++) {
          const segmentFlag = rows[i - 1].flag === 'bridged' || rows[i].flag === 'bridged' ? 'bridged' : 'local';
          if (rows[i].photon - rows[i - 1].photon <= .150001 && segmentFlag === flag) {
            if (!inRun) { x.push(rows[i - 1].photon); y.push(rows[i - 1].value); }
            x.push(rows[i].photon); y.push(rows[i].value); inRun = true;
          } else if (inRun) { x.push(null); y.push(null); inRun = false; }
        }
        return {type: 'scatter', mode: 'lines', x, y, connectgaps: false, name: labels[ch] + ' · paper', line: {color: channelColors[ch], width: 2, dash: flag === 'bridged' ? 'dot' : 'solid'}, hovertemplate: labels[ch] + ' · digitized paper' + (flag === 'bridged' ? ' · reconstructed' : '') + '<br>%{x:.2f} eV<br>%{y:.3g}' + (delay ? ' as' : ' · paper ordinate') + '<extra></extra>'};
      }).filter(trace => trace.x.length);
    }
    async function draw() {
      const scaled = state.scale === 'paper', sigmaKey = scaled ? 'sigma' : 'directional_sigma';
      const traces = {sigma: [], delay: []};
      for (const ch of ['X', 'b', 'A', 'c']) {
        if (!state.channels[ch]) continue;
        const channel = data.channels[ch], inRange = p => p.photon >= 25 && p.photon <= 50;
        const ref = channel.reference[state.convention].filter(inRange), fine = channel.fine[state.convention].filter(inRange), emol = channel.emol[state.convention].filter(inRange);
        if (scaled) traces.sigma.push(...paperLines(channel.paper.sigma, ch, false));
        traces.delay.push(...paperLines(channel.paper.delay, ch, true));
        for (const key of ['sigma', 'delay']) {
          const field = key === 'sigma' ? sigmaKey : 'tau';
          const unit = key === 'delay' ? ' as' : scaled ? ' · 4π-scaled (Mb)' : ' Mb/sr';
          traces[key].push({type: 'scatter', mode: 'lines', name: labels[ch] + ' · independent ePolyScat', x: ref.map(p => p.photon), y: ref.map(p => p[field]), line: {color: channelColors[ch], width: 1.5, dash: 'dash'}, hovertemplate: labels[ch] + ' · independent ePolyScat<br>%{x:.3f} eV<br>%{y:.3g}' + unit + '<extra></extra>'});
          traces[key].push({type: 'scatter', mode: 'markers', name: labels[ch] + ' · reference fine checkpoint', x: fine.map(p => p.photon), y: fine.map(p => p[field]), marker: {color: channelColors[ch], symbol: 'circle-open', size: 7, line: {color: channelColors[ch], width: 1.3}}, hovertemplate: labels[ch] + ' · local fine checkpoint<br>%{x:.3f} eV<br>%{y:.3g}' + unit + '<extra></extra>'});
        }
        if (emol.length) traces.sigma.push(sampleLine({type: 'scatter', mode: 'markers', name: labels[ch] + ' · eMOL', x: emol.map(p => p.photon), y: emol.map(p => p[sigmaKey]), marker: {color: channelColors[ch], symbol: emol.map(p => p.route === 'box' ? 'diamond-open' : 'diamond'), size: emol.length > 20 ? 6 : 7, line: {color: channelColors[ch], width: 1.2}}, customdata: emol.map(p => p.route + (p.at_pole ? ' · near K pole' : '')), hovertemplate: labels[ch] + ' · eMOL<br>%{x:.4f} eV<br>%{y:.3g}' + (scaled ? ' · 4π-scaled (Mb)' : ' Mb/sr') + '<br>%{customdata}<extra></extra>'}));
      }
      convention.textContent = (state.convention === 'omitted' ? 'Y-omitted diagnostic. ' : 'Full x,y,z components. ') + (scaled ? 'Cross-section ordinate comparison: paper numbers versus 4π × calculated dσ/dΩ. These are different normalizations; see details below.' : 'Physical dσ/dΩ in Mb/sr, along polarization. The paper cross-section curve is hidden because its normalization is unresolved.');
      await Promise.all(['sigma', 'delay'].map(key => plot(charts[key], traces[key], {height: 390, margin: {l: 57, r: 15, t: 20, b: 52}, xaxis: {title: 'Photon energy (eV)', range: [25, 50], dtick: 5, gridcolor: '#eaf0f3', zeroline: false}, yaxis: {title: key === 'delay' ? 'Wigner delay (as)' : scaled ? 'Cross-section ordinate' : 'dσ/dΩ (Mb/sr)', rangemode: key === 'sigma' ? 'tozero' : 'normal', gridcolor: '#eaf0f3', zerolinecolor: '#bccbd3'}})));
    }
    await draw();
  }

  async function amplitudes() {
    if (!amplitudePromise) amplitudePromise = new Promise((resolve, reject) => {
      const script = node('script'); script.src = 'no-amplitude-data.js?v=' + DATA_REVISION;
      script.onload = () => {
        try {
          if (!window.NO_AMPLITUDE_DATA || !window.NOPhysics) throw new Error('The NO amplitude data or numerical evaluator is missing.');
          const result = NOPhysics.selftest(NO_AMPLITUDE_DATA);
          window.NO_SELFTEST = result;
          if (!result.passed) throw new Error('The browser amplitude checks failed; angular plots have been stopped.');
          $('selftest-text').textContent = 'Reader validated · ' + result.checks + ' browser checks passed';
          $('selftest-detail').textContent += ' Angular amplitudes are loaded separately and checked against exported numerical references before the plots are built. ' + result.checks + ' browser checks passed.';
          resolve(NO_AMPLITUDE_DATA);
        } catch (error) { reject(error); }
      };
      script.onerror = () => reject(new Error('The NO amplitude file could not be loaded. Reload the page to try again.'));
      document.head.append(script);
    });
    return amplitudePromise;
  }
  async function buildCurves(data) {
    const w = workbench($('curves-root')), s = {channel: 'all', quantity: 'sigma', axis: 'photon_ev'};
    const choices = fieldset(w.settings, 'Observable');
    select(choices, 'Channel', channelOptions(true), s.channel, v => { s.channel = v; return draw(); });
    select(choices, 'Quantity', [['sigma', 'Cross section · σ'], ['components', 'Cartesian components · σx, σy, σz'], ['beta', 'Anisotropy · β']], s.quantity, v => { s.quantity = v; return draw(); });
    const axes = fieldset(w.settings, 'Energy axis');
    select(axes, 'Energy', [['photon_ev', 'Photon energy'], ['energy_ev', 'Electron kinetic energy']], s.axis, v => { s.axis = v; return draw(); });
    note(w.results, 'Markers are calculated energies; straight lines guide the eye between adjacent samples. Open markers identify box-route data. The low-energy b cross section has a reported 5–8% discrepancy with the independent code below 15 eV electron energy; convergence remains under study.');
    note(w.results, 'β is the photoelectron anisotropy parameter here. It is distinct from the polarization angle β used in the angular tabs.');
    async function draw() {
      const channels = s.channel === 'all' ? ['b', 'c', 'X'] : [s.channel], traces = [];
      for (const ch of channels) {
        const points = data.channels[ch].onePhoton;
        for (const part of s.quantity === 'components' ? ['x', 'y', 'z'] : [s.quantity]) {
          const values = points.map(p => part === 'beta' ? p.beta : p.sigma_mb[part === 'sigma' ? 'avg' : part]);
          traces.push(sampleLine({type: 'scatter', mode: 'markers', name: LABELS[ch] + (s.quantity === 'components' ? ' · ' + part : ''), x: points.map(p => p[s.axis]), y: values, marker: {color: COLORS[ch], size: 8, symbol: points.map(p => (part === 'x' ? 'square' : part === 'y' ? 'triangle-up' : 'circle') + (/box/i.test(p.route) ? '-open' : '')), line: {width: 1.5, color: COLORS[ch]}}, customdata: points.map(p => p.route), hovertemplate: LABELS[ch] + (s.quantity === 'components' ? ' · ' + part : '') + '<br>%{x:.4f} eV<br>%{y:.4g}' + (s.quantity === 'beta' ? '' : ' Mb') + '<br>%{customdata}<extra></extra>'}));
        }
      }
      w.context.textContent = s.quantity === 'beta' ? 'Stored anisotropy values · each point is a completed one-photon calculation.' : s.quantity === 'sigma' ? 'Orientation-averaged cross section: σ = (σx + σy + σz) / 3. Unit: megabarn (Mb).' : 'Cartesian cross sections for x, y and z polarization in the molecular frame.';
      await plot(w.chart, traces, {height: 440, showlegend: true, legend: {orientation: 'h', y: 1.14, x: 0, font: {size: 10}}, margin: {l: 65, r: 20, t: 55, b: 55}, xaxis: {title: s.axis === 'photon_ev' ? 'Photon energy (eV)' : 'Electron kinetic energy (eV)', gridcolor: '#eaf0f3'}, yaxis: {title: s.quantity === 'beta' ? 'Anisotropy β' : 'Cross section (Mb)', gridcolor: '#eaf0f3', zerolinecolor: '#b9c9d1'}});
    }
    await draw();
  }
  function evaluator(point, eps, delay) {
    if (delay && NOPhysics.prepareTwoPhoton) return NOPhysics.prepareTwoPhoton(point, eps);
    if (!delay && NOPhysics.prepareOnePhoton) return NOPhysics.prepareOnePhoton(point, eps);
    return (theta, phi) => delay ? NOPhysics.twoPhoton(point, theta, phi, eps) : NOPhysics.onePhoton(point, theta, phi, eps);
  }
  async function buildAngular(kind, data) {
    const w = workbench($(kind + '-root'));
    const state = {channel: 'b', quantity: 'sigma', index: 0, energy: null, alpha: 0, beta: 45, phi: 0, mapStyle: 'smooth'};
    let drawing = null, redrawRequested = false;
    // Keep only the latest requested state while Plotly finishes a redraw.
    // In particular, scrubbing must not queue a separate 3D plot per event.
    function requestDraw() {
      redrawRequested = true;
      if (!drawing) drawing = (async () => {
        try {
          while (redrawRequested) {
            await new Promise(resolve => requestAnimationFrame(resolve));
            redrawRequested = false;
            await draw();
          }
        } finally { drawing = null; }
      })();
      return drawing;
    }
    const primary = fieldset(w.settings, 'Calculation');
    select(primary, 'Channel', channelOptions(), state.channel, v => { state.channel = v; updateEnergies(); return requestDraw(); });
    const quantityOptions = kind === 'surface' ? [['sigma', 'One-photon emission'], ['delay', 'Two-photon strength & delay']] : [['sigma', 'Differential cross section'], ['delay', 'Two-photon delay'], ...(kind === 'polar' ? [['oneDelay', 'One-photon delay']] : [])];
    select(primary, 'Observable', quantityOptions, state.quantity, v => { state.quantity = v; updateEnergies(); return requestDraw(); });
    if (kind === 'map') select(primary, 'Map display', [['smooth', 'Smooth · interpolated'], ['samples', 'Calculated points']], state.mapStyle, v => { state.mapStyle = v; return requestDraw(); });
    const energy = kind === 'map' ? null : energySlider(w.results, kind + '-energy', index => {
      state.index = index; state.energy = points()[index].energy_ev;
      return requestDraw();
    });
    const angles = fieldset(w.settings, 'Molecular-frame angles');
    range(angles, 'α · polarization azimuth', state.alpha, 360, v => { state.alpha = v; return requestDraw(); });
    range(angles, 'β · polarization tilt', state.beta, 180, v => { state.beta = v; return requestDraw(); });
    if (kind !== 'surface') range(angles, 'φ · electron plane', state.phi, kind === 'map' ? 360 : 180, v => { state.phi = v; return requestDraw(); });
    angleLink(w.settings);
    const detail = note(w.results, '');
    note(w.results, 'The molecular +z axis points toward O; −z points toward N. Angular data use the expansion dipole origin in all channels. XUV and IR share the selected linear polarization.');
    if (kind !== 'surface') note(w.results, 'Angle settings apply when their slider is released. The full azimuthal dependence of the stored amplitudes is retained.');
    function points() { return data.channels[state.channel][state.quantity === 'sigma' ? 'onePhoton' : 'sidebands']; }
    function updateEnergies() {
      const ps = points();
      state.index = state.energy === null ? Math.floor(ps.length / 2) : ps.reduce((best, p, i) => Math.abs(p.energy_ev - state.energy) < Math.abs(ps[best].energy_ev - state.energy) ? i : best, 0);
      state.energy = ps[state.index].energy_ev;
      if (energy) energy.set(ps, state.index);
    }
    async function draw() {
      const oneDelay = state.quantity === 'oneDelay', delay = state.quantity !== 'sigma', ps = points(), p = ps[state.index], eps = NOPhysics.polarization(state.alpha * RAD, state.beta * RAD);
      w.context.textContent = LABELS[state.channel] + ' · ' + (kind === 'map' ? ps.length + ' discrete energies' : (p.order ? sampleLabel(p.order) + ' · ' : '') + p.route) + ' · α ' + state.alpha + '° / β ' + state.beta + '°' + (kind === 'surface' ? '' : ' / φ ' + state.phi + '°');
      if (kind === 'map') {
        const xs = [], ys = [], values = [], hover = [], rows = [];
        const angles = Array.from({length: 61}, (_, i) => i * 3);
        for (const point of ps) {
          const f = evaluator(point, eps, delay), row = [];
          for (const angle of angles) {
            const value = f(angle * RAD, state.phi * RAD), v = delay ? (value.valid ? value.delay_as : null) : value;
            row.push(Number.isFinite(v) ? v : null);
            if (!Number.isFinite(v)) continue;
            xs.push(angle); ys.push(point.energy_ev); values.push(v); hover.push(point.order ? sampleLabel(point.order) : point.route);
          }
          rows.push(row);
        }
        const limit = delay ? colorLimit(values) : Math.max(...values, 1e-20);
        const compact = w.chart.clientWidth < 400;
        const color = {colorscale: delay ? 'RdBu' : 'Viridis', reversescale: delay, colorbar: {title: {text: delay ? 'as' : 'Mb/sr'}, thickness: 10, len: .85}};
        const smooth = state.mapStyle === 'smooth';
        let trace;
        if (smooth) {
          const spacing = ps.slice(1).map((point, i) => point.energy_ev - ps[i].energy_ev);
          const grid = NOMap.interpolate({angles, energies: ps.map(point => point.energy_ev), values: rows, halfPeriod: delay ? Math.PI * 24.188843265857 / (2 * p.omega_hartree) : undefined, maxEnergyGap: spacing.length ? 1.5 * Math.min(...spacing) : undefined}, {angleCount: 361, energyCount: 240});
          trace = {type: 'heatmap', ...grid, ...color, zmin: delay ? -limit : 0, zmax: limit, zsmooth: false, connectgaps: false, hoverongaps: false, hovertemplate: 'Interpolated · ϑ %{x:.1f}° · %{y:.4f} eV<br>%{z:.3g}' + (delay ? ' as' : ' Mb/sr') + '<extra></extra>'};
        } else {
          trace = {type: 'scatter', mode: 'markers', x: xs, y: ys, customdata: hover, marker: {...color, symbol: 'square', size: 6, color: values, cmin: delay ? -limit : 0, cmax: limit}, hovertemplate: 'Calculated · ϑ %{x}° · %{y:.4f} eV<br>%{marker.color:.3g}' + (delay ? ' as' : ' Mb/sr') + '<br>%{customdata}<extra></extra>'};
        }
        await plot(w.chart, [trace], {height: 470, margin: {l: compact ? 50 : 64, r: compact ? 48 : 66, t: 15, b: 60}, xaxis: {title: 'Electron angle ϑ (°)', range: [0, 180], tickvals: compact ? [0, 90, 180] : [0, 45, 90, 135, 180], gridcolor: '#eaf0f3'}, yaxis: {title: 'Electron kinetic energy (eV)', range: [ps[0].energy_ev, ps[ps.length - 1].energy_ev], gridcolor: '#eaf0f3'}});
        detail.textContent = (smooth ? 'Colour is linearly interpolated between adjacent calculated energies and angles. Missing energy steps, undefined values and delay phase jumps remain blank. Nothing is extrapolated beyond the sampled range; choose Calculated points to inspect the original samples.' : 'Each row contains samples at one calculated energy, without display interpolation.') + (delay ? ' Colour shows principal-branch delays, limited symmetrically to the 98th percentile of |delay|; hover retains the unclipped value.' : ' Colour gives dσ/dΩ in Mb/sr.');
      } else if (kind === 'surface') {
        const f = evaluator(p, eps, delay), samples = [], colors = [];
        let peak = 0;
        for (let ti = 0; ti <= 36; ti++) {
          const row = [];
          for (let pi = 0; pi <= 72; pi++) {
            const theta = ti * Math.PI / 36, phi = pi * 2 * Math.PI / 72, v = f(theta, phi);
            const strength = delay ? v.strength : v;
            peak = Math.max(peak, Number.isFinite(strength) ? strength : 0);
            row.push({theta, phi, strength, color: delay ? (v.valid ? v.delay_as : null) : v});
            if (delay && v.valid) colors.push(v.delay_as);
          }
          samples.push(row);
        }
        const xyz = axis => samples.map(row => row.map(q => {
          if (delay && q.color === null) return null;
          const radius = Math.max(0, q.strength) / (peak || 1);
          return radius * (axis === 0 ? Math.sin(q.theta) * Math.cos(q.phi) : axis === 1 ? Math.sin(q.theta) * Math.sin(q.phi) : Math.cos(q.theta));
        }));
        const limit = delay ? colorLimit(colors) : peak;
        const traces = [{type: 'surface', x: xyz(0), y: xyz(1), z: xyz(2), connectgaps: false, surfacecolor: samples.map(row => row.map(q => q.color)), colorscale: delay ? 'RdBu' : 'Viridis', reversescale: delay, cmin: delay ? -limit : 0, cmax: limit, colorbar: {title: {text: delay ? 'as' : 'Mb/sr'}, thickness: 12, len: .7}, hovertemplate: 'Colour: %{surfacecolor:.3g}' + (delay ? ' as' : ' Mb/sr') + '<extra></extra>', lighting: {ambient: .8, diffuse: .6, roughness: .9}}, {type: 'scatter3d', mode: 'lines+text', x: [0, 0], y: [0, 0], z: [-1.18, 1.18], text: ['N · −z', 'O · +z'], textposition: ['bottom center', 'top center'], line: {color: '#6f8290', width: 3}, hoverinfo: 'skip'}, {type: 'scatter3d', mode: 'lines+text', x: [0, eps[0] * 1.2], y: [0, eps[1] * 1.2], z: [0, eps[2] * 1.2], text: ['', 'ε'], textposition: 'top center', line: {color: '#df8c43', width: 5}, hoverinfo: 'skip'}];
        const camera = w.chart.layout?.scene?.camera || {eye: {x: 1.5, y: 1.5, z: .8}};
        await plot(w.chart, traces, {height: 500, margin: {l: 0, r: 35, t: 0, b: 0}, scene: {aspectmode: 'cube', camera, xaxis: {title: 'x', range: [-1.3, 1.3], showticklabels: false, showbackground: false, zeroline: false}, yaxis: {title: 'y', range: [-1.3, 1.3], showticklabels: false, showbackground: false, zeroline: false}, zaxis: {title: 'z', range: [-1.3, 1.3], showticklabels: false, showbackground: false, zeroline: false}}, uirevision: 'no-surface-camera'});
        detail.textContent = delay ? 'Radius is the mean two-path intensity (|Aabs|² + |Aemi|²)/2, normalized to its maximum at this sideband. Colour is the principal-branch two-photon delay; undefined nodes are masked and the colour range uses the 98th percentile. Hover retains the unmodified delay.' : 'Radius is dσ/dΩ divided by its maximum at this energy. Colour retains the absolute cross section in Mb/sr. The N/O labels indicate molecular orientation; this is an emission surface, not an orbital.';
      } else {
        const f = oneDelay ? NOPhysics.prepareOnePhotonDelay(p, data.channels[state.channel], eps) : evaluator(p, eps, delay), angles = [], values = [];
        for (let angle = 0; angle <= 360; angle += 2) {
          const theta = (angle <= 180 ? angle : 360 - angle) * RAD, phi = state.phi * RAD + (angle <= 180 ? 0 : Math.PI);
          const v = f(theta, phi); angles.push(angle); values.push(delay ? (v.valid ? v.delay_as : null) : v);
        }
        if (delay) {
          const x = [], y = [], halfPeriod = Math.PI * 24.188843265857 / (2 * p.omega_hartree);
          values.forEach((value, i) => {
            if (i && Number.isFinite(value) && Number.isFinite(values[i - 1]) && Math.abs(value - values[i - 1]) > halfPeriod) { x.push((angles[i - 1] + angles[i]) / 2); y.push(null); }
            x.push(angles[i]); y.push(value);
          });
          const tickStep = Math.pow(10, Math.floor(Math.log10(halfPeriod))) * 3;
          const ticks = [];
          for (let tick = -Math.floor(halfPeriod / tickStep) * tickStep; tick <= halfPeriod; tick += tickStep) ticks.push(tick);
          const compact = w.chart.clientWidth < 400;
          const shownTicks = compact ? ticks.filter(tick => tick === 0 || tick === ticks[0] || tick === ticks[ticks.length - 1]) : ticks;
          const name = oneDelay ? 'One-photon delay' : 'Two-photon delay';
          const zero = {type: 'scatterpolar', mode: 'lines', theta: angles, r: angles.map(() => halfPeriod), line: {color: '#7c8b95', width: 1.5, dash: 'dot'}, hoverinfo: 'skip', showlegend: false};
          const curve = {type: 'scatterpolar', mode: 'lines', name, theta: x, r: y.map(value => Number.isFinite(value) ? value + halfPeriod : null), customdata: y, line: {color: COLORS[state.channel], width: 2.5}, connectgaps: false, hovertemplate: name + '<br>Plane angle %{theta}°<br>%{customdata:.2f} as<extra></extra>'};
          await plot(w.chart, [zero, curve], {height: compact ? 350 : 440, margin: {l: compact ? 32 : 45, r: compact ? 32 : 45, t: 38, b: 38}, polar: {radialaxis: {range: [0, 2 * halfPeriod], tickvals: shownTicks.map(tick => tick + halfPeriod), ticktext: shownTicks.map(tick => tick + ' as'), tickfont: {size: 10}, gridcolor: '#e0e9ed', angle: 30}, angularaxis: {rotation: 90, direction: 'clockwise', tickvals: [0, 90, 180, 270], ticktext: ['0° · O', '90°', '180° · N', '270°'], gridcolor: '#e0e9ed'}, bgcolor: '#fbfcfd'}});
          detail.textContent = 'The dotted ring marks zero delay; negative delays lie inside and positive delays outside. Labels and hover values give signed attoseconds. Undefined directions and phase-wrap jumps remain gaps.' + (oneDelay ? ' One-photon values use route-matched dipoles ' + (2 * p.omega_hartree * 27.211386245988).toFixed(4) + ' eV apart: a finite phase difference, distinct from the Wigner derivative in Figure 4.' : ' The full molecular plane is shown; its second half uses azimuth φ + 180°.');
        } else {
          await plot(w.chart, [{type: 'scatterpolar', mode: 'lines', theta: angles, r: values, line: {color: COLORS[state.channel], width: 2.5}, fill: 'toself', fillcolor: state.channel === 'b' ? '#137f8015' : state.channel === 'c' ? '#b66d4515' : '#6676a315', hovertemplate: 'Plane angle %{theta}°<br>%{r:.4g} Mb/sr<extra></extra>'}], {height: 440, margin: {l: 45, r: 45, t: 38, b: 38}, polar: {radialaxis: {ticksuffix: ' Mb/sr', tickfont: {size: 10}, gridcolor: '#e0e9ed', angle: 30}, angularaxis: {rotation: 90, direction: 'clockwise', tickvals: [0, 90, 180, 270], ticktext: ['0° · O', '90°', '180° · N', '270°'], gridcolor: '#e0e9ed'}, bgcolor: '#fbfcfd'}});
          detail.textContent = 'Radius gives the differential cross section dσ/dΩ. The full plane is shown: the second half uses azimuth φ + 180°. NO has distinct nitrogen and oxygen ends.';
        }
      }
    }
    updateEnergies(); await requestDraw();
  }
  function colorLimit(values) {
    const finite = values.filter(Number.isFinite).map(Math.abs).sort((a, b) => a - b);
    return finite.length ? Math.max(1, finite[Math.floor((finite.length - 1) * .98)]) : 1;
  }
  async function buildLab(data) {
    const w = workbench($('lab-root')), state = {geometry: 'along', field: '0', quantity: 'total', channel: 'all'};
    const main = fieldset(w.settings, 'Average');
    select(main, 'Electron detection', [['along', 'Along polarization · Fig. 3'], ['fourpi', 'All directions · 4π']], state.geometry, v => { state.geometry = v; return draw(); });
    select(main, 'Channel', channelOptions(true), state.channel, v => { state.channel = v; return draw(); });
    const setting = fieldset(w.settings, '4π options');
    const fieldControl = select(setting, 'XUV–IR angle', [['0', '0° · parallel'], ['90', '90° · perpendicular']], state.field, v => { state.field = v; return draw(); });
    const quantityControl = select(setting, 'Delay', [['total', 'Total RABBITT delay'], ['one', 'Stored one-photon term'], ['cc', 'Stored remainder · τR − τ1']], state.quantity, v => { state.quantity = v; return draw(); });
    const extra = note(w.results, '');
    note(w.results, 'Markers show calculations; lines join adjacent samples. All channels use the expansion dipole origin. These absolute delays are calculation-dependent; Figure 3 compares channel differences. No extra continuum–continuum term is added to the full eMOL two-photon result.');
    note(w.results, 'The single Xh hole-set run is a separate diagnostic and is excluded. One-photon delays along the polarization are not inferred from the sparse browser grid.');
    async function draw() {
      const along = state.geometry === 'along', channels = state.channel === 'all' ? ['b', 'c', 'X'] : [state.channel];
      fieldControl.disabled = along; quantityControl.disabled = along; setting.style.opacity = along ? '.5' : '1';
      const traces = channels.map(ch => {
        const points = along ? NO_PAPER_DATA.channels[ch] : data.channels[ch].sidebands;
        const key = {total: 'tau_R_as', one: 'tau_1_as', cc: 'tau_cc_as'}[state.quantity];
        return sampleLine({type: 'scatter', mode: 'markers', name: LABELS[ch], x: points.map(p => p.photon ?? p.photon_ev), y: points.map(p => along ? p.complete : (p.lab[state.field]?.[key] ?? null)), marker: {color: COLORS[ch], size: 9, symbol: points.map(p => p.at_pole ? 'diamond-open' : 'diamond'), line: {color: COLORS[ch], width: 1.5}}, customdata: points.map(p => sampleLabel(p.order)), hovertemplate: LABELS[ch] + ' · %{customdata}<br>%{x:.4f} eV<br>%{y:.2f} as<extra></extra>'});
      });
      w.context.textContent = along ? 'Random molecular orientation · electron along polarization · parallel XUV/IR · full x,y,z amplitudes.' : 'Random molecular orientation · electron directions integrated over 4π · XUV–IR angle ' + state.field + '°.';
      extra.textContent = along ? 'These are the per-channel readings used in the opening comparison. Subtract X at the same photon energy to obtain b−X and c−X. Intermediate calculations use photon-energy indices rather than measured sideband labels.' : 'These are stored 4π lab averages, a different detection geometry from Figure 3. The remainder τR − τ1 is a stored decomposition of the total; it is not an additional correction to it.';
      await plot(w.chart, traces, {height: 430, showlegend: true, legend: {orientation: 'h', y: 1.12}, margin: {l: 65, r: 20, t: 40, b: 55}, xaxis: {title: 'Sideband photon energy (eV)', gridcolor: '#eaf0f3'}, yaxis: {title: 'Delay (as)', gridcolor: '#eaf0f3', zerolinecolor: '#b9c9d1'}});
    }
    await draw();
  }

  async function activate(name, focus = false) {
    active = name;
    const tabs = [...document.querySelectorAll('.no-nav [role="tab"]')];
    tabs.forEach(tab => { const selected = tab.id === 'view-' + name; tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1; $(tab.getAttribute('aria-controls')).hidden = !selected; });
    const tab = $('view-' + name);
    if (focus) { tab.focus({preventScroll: true}); tab.scrollIntoView({block: 'nearest', inline: 'nearest'}); }
    if (!built.has(name)) {
      built.add(name);
      const root = $(name + '-root');
      try {
        if (name === 'paper') await buildPaper();
        else if (name === 'frames') frameGuide = EmolSections.buildFrameGuide(root, {meta: {molecule: 'NO'}});
        else {
          root.replaceChildren(node('p', 'no-loading', 'Loading and checking the molecular amplitudes…'));
          const data = await amplitudes();
          if (name === 'curves') await buildCurves(data);
          else if (name === 'lab') await buildLab(data);
          else await buildAngular(name, data);
        }
      } catch (error) { built.delete(name); root.replaceChildren(node('p', 'error', error.message)); throw error; }
    }
    await resize();
  }
  async function resize() {
    const charts = [...$('section-' + active).querySelectorAll('.js-plotly-plot')].filter(p => p.clientWidth);
    await Promise.all(charts.map(p => Plotly.Plots.resize(p)));
    if (active === 'map' && charts[0]) {
      const compact = charts[0].clientWidth < 400;
      await Plotly.relayout(charts[0], {'xaxis.tickvals': compact ? [0, 90, 180] : [0, 45, 90, 135, 180], 'margin.l': compact ? 50 : 64, 'margin.r': compact ? 48 : 66});
    }
    if (active === 'frames' && frameGuide) frameGuide.render();
    postHeight();
  }
  function init() {
    if (!window.Plotly || !window.NO_PAPER_DATA) throw new Error('The plotting library or paper dataset did not load.');
    const validation = NO_PAPER_DATA.meta.validation;
    if (!validation.passed) throw new Error('The exported paper dataset did not pass its reader checks.');
    $('selftest-badge').className = 'selftest selftest-pass';
    $('snapshot-date').textContent = 'Data snapshot · ' + new Date(NO_PAPER_DATA.meta.snapshot + 'T00:00:00Z').toLocaleDateString('en-GB', {day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'});
    $('sample-count').textContent = validation.raw_sidebands_checked;
    $('selftest-text').textContent = 'Reader validated · ' + validation.raw_sidebands_checked + ' energy samples checked';
    $('selftest-detail').textContent = validation.reader_checks + ' reader checks passed during export. ' + validation.raw_sidebands_checked + ' two-photon energy samples were recalculated from ' + validation.raw_amplitude_files_checked + ' amplitude files and reproduced the saved readings within rounding precision. This verifies data handling, not agreement with the published theory. Angular views run additional browser checks when opened.';
    const tabs = [...document.querySelectorAll('.no-nav [role="tab"]')];
    tabs.forEach((tab, index) => {
      tab.addEventListener('click', guarded(() => activate(tab.id.slice(5))));
      tab.addEventListener('keydown', event => {
        let next;
        if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
        if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
        if (event.key === 'Home') next = 0;
        if (event.key === 'End') next = tabs.length - 1;
        if (next !== undefined) { event.preventDefault(); guarded(() => activate(tabs[next].id.slice(5), true))(); }
      });
    });
    window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(guarded(resize), 120); });
    new ResizeObserver(() => postHeight()).observe(document.body);
    document.addEventListener('toggle', () => requestAnimationFrame(postHeight), true);
    window.NOExplorer = {activate, resize};
    return activate('paper');
  }
  guarded(init)();
})();
