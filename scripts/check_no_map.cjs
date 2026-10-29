#!/usr/bin/env node
/* Independent checks for display interpolation and preservation of gaps. */
'use strict';
const assert = require('node:assert/strict');
const map = require('../assets/viz/no-map.js');

let checks = 0;
function close(actual, expected) {
  checks++;
  assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) < 1e-10,
    `Expected ${expected}, received ${actual}`);
}
function equal(actual, expected) { checks++; assert.deepEqual(actual, expected); }

const angles = [0, .7, 3.5, 7], energies = [5, 5.9, 12];
const plane = (angle, energy) => 2 + 3 * angle - 4 * energy + .75 * angle * energy;
const source = {angles, energies, values: energies.map(energy => angles.map(angle => plane(angle, energy)))};
const snapshot = JSON.stringify(source);
for (const angle of [0, .1, .7, 1.7, 3.5, 6, 7]) {
  for (const energy of [5, 5.3, 5.9, 9, 12]) close(map.sampleAt(source, angle, energy), plane(angle, energy));
}
const dense = map.interpolate(source, {angleCount: 39, energyCount: 27});
equal(dense.x.length, 39); equal(dense.y.length, 27);
equal(dense.z.length, 27); equal(dense.z.every(row => row.length === 39), true);
equal([dense.x[0], dense.x.at(-1), dense.y[0], dense.y.at(-1)], [0, 7, 5, 12]);
dense.z.forEach((row, j) => row.forEach((value, i) => close(value, plane(dense.x[i], dense.y[j]))));
equal(JSON.stringify(source), snapshot);
equal(map.interpolate(source).z.length, 160);
equal(map.interpolate(source).z[0].length, 181);

for (const [angle, energy] of [[-1, 6], [8, 6], [2, 4], [2, 13]]) equal(map.sampleAt(source, angle, energy), null);
const hole = {angles: [0, 1, 2], energies: [0, 1], values: [[2, 4, 8], [null, 6, 10]]};
equal(map.sampleAt(hole, .5, .5), null);
equal(map.sampleAt(hole, 0, 1), null);
close(map.sampleAt(hole, .5, 0), 3);
close(map.sampleAt(hole, 1, .5), 5);
close(map.sampleAt(hole, 1, 0), 4);
close(map.sampleAt(hole, 1.5, .5), 7);

const jump = {angles: [0, 1], energies: [0, 1], values: [[-600, 600], [-500, 500]], halfPeriod: 667};
equal(map.sampleAt(jump, .5, .5), null);
equal(map.sampleAt(jump, .5, 0), null);
close(map.sampleAt(jump, 0, 0), -600);
close(map.sampleAt(jump, 1, 0), 600);
close(map.sampleAt(jump, 0, .5), -550);
close(map.sampleAt(jump, 1, .5), 550);
// An ordinary zero crossing is continuous, and must not be mistaken for a
// principal-branch discontinuity merely because the samples have both signs.
const zero = {...jump, values: [[-100, 100], [-50, 50]]};
close(map.sampleAt(zero, .5, .5), 0);
const verticalJump = {...jump, values: [[-600, -500], [600, 500]]};
equal(map.sampleAt(verticalJump, .5, .5), null);
close(map.sampleAt(verticalJump, .5, 0), -550);
close(map.sampleAt(verticalJump, .5, 1), 550);

const single = {angles: [0, 2], energies: [5], values: [[1, 3]]};
close(map.sampleAt(single, 1, 5), 2);
equal(map.sampleAt(single, 1, 5.001), null);
equal(map.interpolate(single, {angleCount: 3}).z, [[1, 2, 3]]);
equal(map.interpolate({angles: [0], energies: [5], values: [[7]]}), {x: [0], y: [5], z: [[7]]});

const energyGap = {angles: [0, 2], energies: [5, 6, 8], values: [[1, 3], [3, 5], [7, 9]], maxEnergyGap: 1.5};
close(map.sampleAt(energyGap, 1, 5), 2);
close(map.sampleAt(energyGap, 1, 5.5), 3);
close(map.sampleAt(energyGap, 1, 6), 4);
close(map.sampleAt(energyGap, 1, 8), 8);
equal(map.sampleAt(energyGap, 1, 7), null);
equal(map.sampleAt(energyGap, 0, 7), null);
equal(map.interpolate(energyGap, {angleCount: 3, energyCount: 7}).z[3], [null, null, null]);
close(map.sampleAt({...energyGap, maxEnergyGap: 2}, 1, 7), 6);
close(map.sampleAt({...energyGap, maxEnergyGap: undefined}, 1, 7), 6);

for (const bad of [
  null, {...source, angles: []}, {...source, angles: [0, 0, 1, 2]},
  {...source, angles: [0, 3, 2, 4]}, {...source, energies: [5, NaN, 12]},
  {...source, values: [[1, 2, 3, 4]]}, {...source, values: [[1], [2], [3]]},
  {...hole, values: [[2, Infinity, 8], [null, 6, 10]]},
  {...source, halfPeriod: 0}, {...source, halfPeriod: Infinity},
  {...source, maxEnergyGap: 0}, {...source, maxEnergyGap: -1}, {...source, maxEnergyGap: Infinity}
]) { checks++; assert.throws(() => map.interpolate(bad)); }
for (const count of [1, 2.5, Infinity, NaN]) {
  checks++; assert.throws(() => map.interpolate(source, {angleCount: count}));
}
checks++; assert.throws(() => map.sampleAt(source, NaN, 7));
console.log(`PASS: ${checks} map checks; irregular grids, exact nodes, no extrapolation, null and phase-wrap gaps.`);
