/* Display interpolation for the NO energy–angle map.
 * This does not create new calculated amplitudes or energy samples. Cells
 * containing undefined values or a principal-phase jump remain blank.
 */
(function (root) {
  'use strict';

  function finite(value) { return typeof value === 'number' && Number.isFinite(value); }
  function require(condition, message) { if (!condition) throw new Error(message); }
  function validate(data) {
    require(data && typeof data === 'object', 'A sampled energy–angle map is required.');
    for (const key of ['angles', 'energies']) {
      const axis = data[key];
      require(Array.isArray(axis) && axis.length > 0, 'Map ' + key + ' must be a nonempty array.');
      require(axis.every(finite), 'Map ' + key + ' must be finite.');
      require(axis.every((value, i) => !i || value > axis[i - 1]), 'Map ' + key + ' must be strictly increasing.');
    }
    require(Array.isArray(data.values) && data.values.length === data.energies.length, 'Map row count must match energies.');
    require(data.values.every(row => Array.isArray(row) && row.length === data.angles.length), 'Map column count must match angles.');
    require(data.values.every(row => row.every(value => value === null || finite(value))), 'Map values must be finite numbers or null.');
    require(data.halfPeriod === undefined || (finite(data.halfPeriod) && data.halfPeriod > 0), 'Delay half-period must be positive and finite.');
    require(data.maxEnergyGap === undefined || (finite(data.maxEnergyGap) && data.maxEnergyGap > 0), 'Maximum energy gap must be positive and finite.');
    return data;
  }

  // Exact nodes and grid lines use only their contributing samples. A null
  // in a neighbouring cell cannot erase an actual calculated value.
  function bracket(axis, value) {
    if (value < axis[0] || value > axis[axis.length - 1]) return null;
    let lo = 0, hi = axis.length - 1;
    while (lo <= hi) {
      const middle = Math.floor((lo + hi) / 2);
      if (value === axis[middle]) return {lo: middle, hi: middle, fraction: 0};
      if (value < axis[middle]) hi = middle - 1;
      else lo = middle + 1;
    }
    return {lo: hi, hi: lo, fraction: (value - axis[hi]) / (axis[lo] - axis[hi])};
  }

  function evaluate(data, x, y) {
    if (!x || !y) return null;
    // A known missing energy row stays visible as a gap. An exact endpoint
    // has y.lo === y.hi and still displays its own calculated angular cut.
    if (data.maxEnergyGap !== undefined && y.lo !== y.hi && data.energies[y.hi] - data.energies[y.lo] > data.maxEnergyGap) return null;
    const columns = x.lo === x.hi ? [x.lo] : [x.lo, x.hi];
    const rows = y.lo === y.hi ? [y.lo] : [y.lo, y.hi];
    let minimum = Infinity, maximum = -Infinity;
    for (const row of rows) {
      for (const column of columns) {
        const value = data.values[row][column];
        if (value === null) return null;
        minimum = Math.min(minimum, value);
        maximum = Math.max(maximum, value);
      }
    }
    if (data.halfPeriod !== undefined && maximum - minimum > data.halfPeriod) return null;
    const low = data.values[y.lo][x.lo] * (1 - x.fraction) + data.values[y.lo][x.hi] * x.fraction;
    const high = data.values[y.hi][x.lo] * (1 - x.fraction) + data.values[y.hi][x.hi] * x.fraction;
    return low * (1 - y.fraction) + high * y.fraction;
  }

  function sampleAt(data, angle, energy) {
    validate(data);
    require(finite(angle) && finite(energy), 'Map query coordinates must be finite.');
    return evaluate(data, bracket(data.angles, angle), bracket(data.energies, energy));
  }

  function uniform(axis, count) {
    require(Number.isInteger(count) && count >= 2, 'Map display resolution must be an integer of at least two.');
    if (axis.length === 1) return [axis[0]];
    const first = axis[0], last = axis[axis.length - 1];
    return Array.from({length: count}, (_, i) => i === count - 1 ? last : first + (last - first) * i / (count - 1));
  }

  function interpolate(data, options = {}) {
    validate(data);
    require(options && typeof options === 'object', 'Map display options must be an object.');
    const x = uniform(data.angles, options.angleCount === undefined ? 181 : options.angleCount);
    const y = uniform(data.energies, options.energyCount === undefined ? 160 : options.energyCount);
    const columns = x.map(value => bracket(data.angles, value));
    const rows = y.map(value => bracket(data.energies, value));
    const z = rows.map(row => columns.map(column => evaluate(data, column, row)));
    return {x, y, z};
  }

  const api = {interpolate, sampleAt};
  root.NOMap = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
