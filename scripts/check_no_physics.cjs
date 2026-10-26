#!/usr/bin/env node
/* Browser/Python agreement plus independent integration and node checks. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const context = {window: {}, console};
vm.createContext(context);
for (const file of ['no-amplitude-data.js', 'no-physics.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, 'assets/viz', file), 'utf8'), context, {filename: file});
}
const data = context.window.NO_AMPLITUDE_DATA;
const physics = context.window.NOPhysics;
const result = physics.selftest(data);
assert.ok(result.passed, JSON.stringify(result.failures));

function gaussLegendre(n) {
  const nodes = [], weights = [];
  for (let i = 1; i <= n; i++) {
    let z = Math.cos(Math.PI * (i - 0.25) / (n + 0.5)), derivative;
    for (let iteration = 0; iteration < 30; iteration++) {
      let p0 = 1, p1 = z;
      for (let l = 2; l <= n; l++) { const next = ((2*l-1)*z*p1-(l-1)*p0)/l; p0=p1; p1=next; }
      derivative = n * (z * p1 - p0) / (z*z - 1);
      const delta = p1 / derivative;
      z -= delta;
      if (Math.abs(delta) < 1e-15) break;
    }
    nodes.push(z);
    weights.push(2 / ((1-z*z)*derivative*derivative));
  }
  return {nodes, weights};
}
const quadrature = gaussLegendre(52);
let integrationChecks = 0, worstIntegral = 0, maskedNodes = 0;
for (const channel of Object.values(data.channels)) {
  const point = channel.onePhoton[Math.floor(channel.onePhoton.length / 2)];
  for (let axis = 0; axis < 3; axis++) {
    const eps = [0,0,0]; eps[axis] = 1;
    const evaluate = physics.prepareOnePhoton(point, eps);
    let integral = 0;
    for (let i = 0; i < quadrature.nodes.length; i++) {
      for (let phi = 0; phi < 32; phi++) {
        integral += evaluate(Math.acos(quadrature.nodes[i]), 2*Math.PI*phi/32) * quadrature.weights[i] * 2*Math.PI/32;
      }
    }
    const expected = point.sigma_mb[['x','y','z'][axis]];
    const error = Math.abs(integral - expected) / expected;
    worstIntegral = Math.max(worstIntegral, error);
    assert.ok(error < 2e-9, channel.label + ' cross-section integral mismatch: ' + error);
    integrationChecks++;
  }
  for (const sb of channel.sidebands) {
    const eps = physics.polarization(0.731, 0.941);
    const evaluate = physics.prepareTwoPhoton(sb, eps);
    const first = evaluate(1.219, 2.123), wrapped = evaluate(1.219, 2.123 + 2*Math.PI);
    assert.ok(first.valid && wrapped.valid);
    assert.ok(Math.abs(first.delay_as - wrapped.delay_as) < 1e-8);
    assert.ok(Math.abs(first.delay_as - physics.twoPhoton(sb,1.219,2.123,eps).delay_as) < 1e-10);
  }
}
for (const sb of data.channels.X.sidebands) {
  for (const theta of [0, Math.PI]) {
    const value = physics.twoPhoton(sb,theta,0,[0,0,1]);
    assert.equal(value.valid,false,'X axis is symmetry forbidden.');
    assert.equal(value.delay_as,null,'Node delay must remain absent.');
    maskedNodes++;
  }
}
const evaluate = physics.prepareTwoPhoton(data.channels.b.sidebands[1], physics.polarization(.7,.9));
const start = performance.now();
for(let t=0;t<=36;t++) for(let p=0;p<=72;p++) evaluate(t*Math.PI/36,p*2*Math.PI/72);
console.log(JSON.stringify({browser:result,integrationChecks,worstIntegral,maskedNodes,
  surfaceSamples:37*73,surfaceMilliseconds:Math.round(performance.now()-start)},null,2));
