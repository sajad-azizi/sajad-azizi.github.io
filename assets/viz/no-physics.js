/* NO angular observables at computed energies. No interpolation or Wigner derivatives.
 * D already carries its outgoing-wave phase. M carries the NO reader's final
 * (-i)^l Coulomb phase, applied during export. All harmonics are orthonormal
 * real harmonics with no Condon–Shortley phase; angles below are radians.
 */
(function (root) {
  'use strict';
  var ATOMIC_TIME_AS = 24.188843265857;
  var CONDITION_MIN = 1e-10;
  // Match the production direction reader's amplitude floor of 1e-6 RMS.
  var INTENSITY_MIN = 1e-12;
  var basisCache = new WeakMap();

  function finite(value) { return typeof value === 'number' && Number.isFinite(value); }
  function polarization(alpha, beta) {
    if (!finite(alpha) || !finite(beta)) throw new Error('Polarization angles must be finite.');
    return [Math.sin(beta) * Math.cos(alpha), Math.sin(beta) * Math.sin(alpha), Math.cos(beta)];
  }
  function unit(eps) {
    if (!eps || eps.length !== 3 || !Array.from(eps).every(finite)) throw new Error('A finite Cartesian polarization is required.');
    var norm = Math.hypot(eps[0], eps[1], eps[2]);
    if (!(norm > 0)) throw new Error('Polarization cannot be zero.');
    return [eps[0] / norm, eps[1] / norm, eps[2] / norm];
  }
  function basis(point) {
    if (basisCache.has(point)) return basisCache.get(point);
    if (!point.l || point.l.length !== point.m.length) throw new Error('Invalid harmonic channels.');
    var groups = new Map();
    point.l.forEach(function (l, i) {
      var m = Math.abs(point.m[i]);
      if (!Number.isInteger(l) || !Number.isInteger(m) || m > l || l < 0 || l > 1000) throw new Error('Invalid l,m channel.');
      if (!groups.has(m)) groups.set(m, {m: m, lmax: l, indices: []});
      var group = groups.get(m);
      group.lmax = Math.max(l, group.lmax);
      group.indices.push(i);
    });
    var result = {groups: Array.from(groups.values()), thetaRows: new Map()};
    basisCache.set(point, result);
    return result;
  }
  function thetaRow(point, theta) {
    if (!finite(theta) || theta < -1e-12 || theta > Math.PI + 1e-12) throw new Error('Electron polar angle must be between 0 and pi.');
    var cache = basis(point);
    if (cache.thetaRows.has(theta)) return cache.thetaRows.get(theta);
    var row = new Float64Array(point.l.length);
    var x = Math.cos(theta), sine = Math.abs(Math.sin(theta));
    cache.groups.forEach(function (group) {
      var m = group.m, product = 1;
      for (var j = 1; j <= m; j++) product *= (2 * j - 1) / (2 * j);
      // Start with the positive seed: the real basis cancels the CS phase.
      var seed = Math.sqrt((2 * m + 1) * product / (4 * Math.PI)) * Math.pow(sine, m);
      var values = new Float64Array(group.lmax + 1);
      values[m] = seed;
      var previous = 0, current = seed;
      for (var l = m + 1; l <= group.lmax; l++) {
        var lower = l - 1;
        var a = Math.sqrt((4 * l * l - 1) / (l * l - m * m));
        var b = Math.sqrt((lower * lower - m * m) / (4 * lower * lower - 1));
        var next = a * (x * current - b * previous);
        values[l] = next;
        previous = current;
        current = next;
      }
      var factor = m ? Math.SQRT2 : 1;
      group.indices.forEach(function (index) { row[index] = factor * values[point.l[index]]; });
    });
    if (cache.thetaRows.size >= 512) cache.thetaRows.delete(cache.thetaRows.keys().next().value);
    cache.thetaRows.set(theta, row);
    return row;
  }
  function harmonics(point, theta, phi) {
    if (!finite(phi)) throw new Error('Electron azimuth must be finite.');
    var factors = thetaRow(point, theta);
    var result = new Float64Array(factors.length);
    basis(point).groups.forEach(function (group) {
      var c = Math.cos(group.m * phi), s = Math.sin(group.m * phi);
      group.indices.forEach(function (i) {
        result[i] = factors[i] * (point.m[i] > 0 ? c : point.m[i] < 0 ? s : 1);
      });
    });
    return result;
  }
  function dipole(point, eps) {
    var n = point.l.length, real = new Float64Array(n), imag = new Float64Array(n);
    for (var q = 0; q < 3; q++) {
      for (var i = 0; i < n; i++) {
        real[i] += eps[q] * point.D[q][i][0];
        imag[i] += eps[q] * point.D[q][i][1];
      }
    }
    return {real: real, imag: imag};
  }
  function tensor(point, values, eps) {
    var n = point.l.length, real = new Float64Array(n), imag = new Float64Array(n);
    for (var q = 0; q < 3; q++) {
      for (var s = 0; s < 3; s++) {
        var weight = eps[q] * eps[s];
        for (var i = 0; i < n; i++) {
          real[i] += weight * values[q][s][i][0];
          imag[i] += weight * values[q][s][i][1];
        }
      }
    }
    var mean = 0;
    for (var j = 0; j < n; j++) mean += real[j] * real[j] + imag[j] * imag[j];
    return {real: real, imag: imag, mean: mean / (4 * Math.PI)};
  }
  function sum(coefficients, y, conditioning) {
    var real = 0, imag = 0, bound = 0;
    for (var i = 0; i < y.length; i++) {
      var r = coefficients.real[i] * y[i], im = coefficients.imag[i] * y[i];
      real += r;
      imag += im;
      if (conditioning) bound += Math.hypot(r, im);
    }
    var intensity = real * real + imag * imag;
    return {real: real, imag: imag, intensity: intensity,
      condition: bound > 0 ? Math.sqrt(intensity) / bound : 0};
  }
  function prepareOnePhoton(point, eps) {
    var coefficients = dipole(point, unit(eps));
    if (!finite(point.prefactor_mb) || point.prefactor_mb <= 0) throw new Error('Invalid cross-section prefactor.');
    return function (theta, phi) {
      return sum(coefficients, harmonics(point, theta, phi), false).intensity * point.prefactor_mb;
    };
  }
  function onePhoton(point, theta, phi, eps) { return prepareOnePhoton(point, eps)(theta, phi); }
  function prepareOnePhotonDelay(point, channel, eps) {
    var pair = point.one_photon_pair;
    if (!pair || pair.method !== 'finite_difference_pair' || !finite(point.omega_hartree) || point.omega_hartree <= 0) {
      throw new Error('A validated one-photon harmonic pair is required.');
    }
    eps = unit(eps);
    var paths = ['lo', 'hi'].map(function (key, index) {
      var ref = pair[key];
      if (!ref || !['onePhoton', 'extraDipoles'].includes(ref.pool)) throw new Error('Invalid harmonic dipole reference.');
      var dip = channel[ref.pool] && channel[ref.pool][ref.index];
      var expected = point.energy_ev + (index ? 1 : -1) * point.omega_hartree * 27.211386245988;
      if (!dip || dip.source !== pair[key + '_source'] || dip.route !== point.route || Math.abs(dip.energy_ev - expected) > 1e-7) {
        throw new Error('The one-photon pair must use the same route and exact harmonic energies.');
      }
      var coefficients = dipole(dip, eps), mean = 0;
      for (var i = 0; i < coefficients.real.length; i++) mean += coefficients.real[i] * coefficients.real[i] + coefficients.imag[i] * coefficients.imag[i];
      return {point: dip, coefficients: coefficients, mean: mean / (4 * Math.PI)};
    });
    return function (theta, phi) {
      var lo = sum(paths[0].coefficients, harmonics(paths[0].point, theta, phi), true);
      var hi = sum(paths[1].coefficients, harmonics(paths[1].point, theta, phi), true);
      var valid = lo.condition > CONDITION_MIN && hi.condition > CONDITION_MIN &&
        lo.intensity > INTENSITY_MIN * paths[0].mean && hi.intensity > INTENSITY_MIN * paths[1].mean;
      var productReal = hi.real * lo.real + hi.imag * lo.imag;
      var productImag = hi.imag * lo.real - hi.real * lo.imag;
      var strength = (lo.intensity + hi.intensity) / 2;
      return {
        delay_as: valid ? Math.atan2(productImag, productReal) * ATOMIC_TIME_AS / (2 * point.omega_hartree) : null,
        strength: strength,
        contrast: valid ? Math.min(1, Math.sqrt(lo.intensity) * Math.sqrt(hi.intensity) / strength) : null,
        valid: valid,
        conditioning: Math.min(lo.condition, hi.condition)
      };
    };
  }
  function onePhotonDelay(point, channel, theta, phi, eps) { return prepareOnePhotonDelay(point, channel, eps)(theta, phi); }
  function prepareTwoPhoton(point, eps) {
    eps = unit(eps);
    if (!finite(point.omega_hartree) || point.omega_hartree <= 0 || point.origin !== 'expansion') throw new Error('Invalid sideband convention.');
    var absorption = tensor(point, point.M_abs, eps), emission = tensor(point, point.M_emi, eps);
    return function (theta, phi) {
      var y = harmonics(point, theta, phi);
      var a = sum(absorption, y, true), e = sum(emission, y, true);
      var valid = a.condition > CONDITION_MIN && e.condition > CONDITION_MIN &&
        a.intensity > INTENSITY_MIN * absorption.mean && e.intensity > INTENSITY_MIN * emission.mean;
      var productReal = e.real * a.real + e.imag * a.imag;
      var productImag = e.imag * a.real - e.real * a.imag;
      var strength = (a.intensity + e.intensity) / 2;
      return {
        delay_as: valid ? Math.atan2(productImag, productReal) * ATOMIC_TIME_AS / (2 * point.omega_hartree) : null,
        strength: strength,
        contrast: valid ? Math.min(1, Math.sqrt(a.intensity) * Math.sqrt(e.intensity) / strength) : null,
        valid: valid,
        conditioning: Math.min(a.condition, e.condition)
      };
    };
  }
  function twoPhoton(point, theta, phi, eps) { return prepareTwoPhoton(point, eps)(theta, phi); }

  function selftest(data) {
    var report = {passed: true, checks: 0, maxRelativeError: 0, failures: []};
    function compare(actual, expected, tolerance, label) {
      report.checks++;
      var error = Math.abs(actual - expected) / Math.max(1, Math.abs(expected));
      report.maxRelativeError = Math.max(report.maxRelativeError, error);
      if (!finite(actual) || error > tolerance) report.failures.push(label + ': error ' + error);
    }
    if (!data || !data.selftests) return {passed: false, checks: 0, maxRelativeError: null, failures: ['Missing numeric reference vectors.']};
    try {
      data.selftests.onePhoton.forEach(function (test) {
        var value = onePhoton(data.channels[test.channel].onePhoton[test.index], test.theta, test.phi, test.eps);
        compare(value, test.expected, 2e-9, test.channel + ' dipole ' + test.index);
      });
      data.selftests.twoPhoton.forEach(function (test) {
        var point = data.channels[test.channel].sidebands[test.index];
        var value = twoPhoton(point, test.theta, test.phi, test.eps);
        var label = test.channel + ' SB' + point.order;
        report.checks++;
        if (value.valid !== test.expected.valid) report.failures.push(label + ': node classification differs');
        compare(value.strength, test.expected.strength, 2e-9, label + ' intensity');
        if (test.expected.valid && value.valid) {
          compare(value.contrast, test.expected.contrast, 2e-9, label + ' contrast');
          var delta = (value.delay_as - test.expected.delay_as) * 2 * point.omega_hartree / ATOMIC_TIME_AS;
          var wrapped = Math.atan2(Math.sin(delta), Math.cos(delta)) * ATOMIC_TIME_AS / (2 * point.omega_hartree);
          compare(wrapped, 0, 1e-7, label + ' delay');
        } else if (!test.expected.valid && (value.delay_as !== null || value.contrast !== null)) {
          report.failures.push(label + ': undefined node observables must be null');
        }
      });
      if (!data.selftests.onePhotonDelay) throw new Error('Missing one-photon delay references.');
      data.selftests.onePhotonDelay.forEach(function (test) {
        var channel = data.channels[test.channel], point = channel.sidebands[test.index];
        var value = onePhotonDelay(point, channel, test.theta, test.phi, test.eps);
        var label = test.channel + ' one-photon pair ' + point.order;
        report.checks++;
        if (value.valid !== test.expected.valid) report.failures.push(label + ': node classification differs');
        compare(value.strength, test.expected.strength, 2e-9, label + ' intensity');
        if (test.expected.valid && value.valid) {
          compare(value.contrast, test.expected.contrast, 2e-9, label + ' contrast');
          var delta = (value.delay_as - test.expected.delay_as) * 2 * point.omega_hartree / ATOMIC_TIME_AS;
          var wrapped = Math.atan2(Math.sin(delta), Math.cos(delta)) * ATOMIC_TIME_AS / (2 * point.omega_hartree);
          compare(wrapped, 0, 1e-7, label + ' delay');
        } else if (!test.expected.valid && (value.delay_as !== null || value.contrast !== null)) {
          report.failures.push(label + ': undefined node observables must be null');
        }
      });
    } catch (error) { report.failures.push(error.message); }
    report.passed = report.failures.length === 0;
    return report;
  }
  root.NOPhysics = {polarization: polarization, onePhoton: onePhoton, twoPhoton: twoPhoton,
    onePhotonDelay: onePhotonDelay, prepareOnePhotonDelay: prepareOnePhotonDelay,
    prepareOnePhoton: prepareOnePhoton, prepareTwoPhoton: prepareTwoPhoton, harmonics: harmonics,
    selftest: selftest, nodeConditionMinimum: CONDITION_MIN};
})(typeof window !== 'undefined' ? window : globalThis);
