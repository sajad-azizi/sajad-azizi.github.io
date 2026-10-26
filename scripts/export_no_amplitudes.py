#!/usr/bin/env python3
"""Read the NO campaign and export the discrete browser amplitude samples.

    python -B scripts/export_no_amplitudes.py --source-root /path/to/mpi_static_exchangeHF

Requires numpy/scipy/h5py and the campaign's validated Fig. 3 reader. No
scientific source is changed. Derivatives, interpolation and hole-set Xh runs
are deliberately absent. Missing main-route energies use the available OFF
redo, explicitly labelled; no duplicate energy or mixed amplitude is allowed.

The browser's two-photon tensors include the final partial-wave phase
(-i)^l exp(i sigma_l). They are in the expansion-origin convention. All nine
Cartesian photon-component pairs are retained. Coefficients are sparsified
only below 1e-12 of the largest coefficient, with discarded weight recorded.
Every stored molecular-direction reading is checked before export, and the
browser receives independent dense-amplitude reference vectors.
"""

import argparse
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import re
import sys

sys.dont_write_bytecode = True
import h5py
import numpy as np

EV = 27.211386245988
AS = 24.188843265857
MB = 28.0028520539
THRESHOLD = 1e-12
CONDITION_MIN = 1e-10
# The production direction reader refuses amplitudes below 1e-6 of their
# spherical RMS; squaring that criterion gives this intensity threshold.
INTENSITY_MIN = 1e-12
IP = {"b": 16.56, "c": 21.72, "X": 9.26}
LABEL = {"b": "b ³Π", "c": "c ³Π", "X": "X ¹Σ⁺"}
CAMPAIGN = Path("far_field_scratch/no/comphys2026")
DATA = CAMPAIGN / "emol_data/cp26fig3"
FIT = re.compile(r"^\[fused\] fit K symmetry (?P<ksym>[0-9.e+-]+) \| S unitarity [0-9.e+-]+"
                 r" \| eigenphase min (?P<emin>[-+0-9.]+) max (?P<emax>[-+0-9.]+)", re.M)
GEOMETRIES = [(0.0, 0.0, 0.0, 0.0), (math.pi, 0.0, 0.0, 0.0),
              (math.pi / 2, 0.0, 0.0, math.pi / 2),
              (0.731, 1.123, 0.431, 0.927), (2.238, 4.193, 1.728, 2.113),
              (1.122, 2.641, 4.211, 1.338)]


def require(condition, message):
    if not condition:
        raise ValueError(message)


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    result = importlib.util.module_from_spec(spec)
    sys.modules[name] = result
    spec.loader.exec_module(result)
    return result


class Export:
    def __init__(self, root):
        self.root = root
        self.files = set()
        self.tests = {"onePhoton": [], "twoPhoton": []}
        self.excluded = []
        self.checks = {"dipole_prefactors": 0, "stored_direction_delays": 0,
                       "stored_direction_strengths": 0, "lab_interference_delays": 0,
                       "stored_direction_refusals": 0, "sideband_identity_gates": 0}
        self.worst = {"direction_delay_as": 0.0, "direction_strength_relative": 0.0,
                      "dipole_prefactor_relative": 0.0, "lab_delay_as": 0.0}
        self.ca = module("comphys_analysis", self.add(root / CAMPAIGN / "wf1/library/comphys_analysis.py"))
        self.reader = module("no_amplitude_reader", self.add(root / CAMPAIGN / "analysis/fig3_reader/emol_fig3_reader.py"))

    def add(self, path):
        path = path.resolve()
        path.relative_to(self.root)
        require(path.is_file(), "Missing scientific source: %s" % path)
        self.files.add(path)
        return path

    def relative(self, path):
        return path.relative_to(self.root / DATA).as_posix()

    def read(self, path):
        return h5py.File(self.add(path), "r")

    def manifest(self):
        return [{"path": p.relative_to(self.root).as_posix(),
                 "sha256": hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted(self.files)]

    def incomplete(self, path, reason):
        self.excluded.append({"source": self.relative(path), "reason": reason})
        return False

    def complete_run(self, directory):
        done = directory / "RUN_DONE"
        if not done.is_file():
            return self.incomplete(directory, "Centre run completion record is not available")
        require(re.search(r"\brc 0\b", self.add(done).read_text()) is not None,
                "Centre run did not complete successfully: " + str(directory))
        if not (directory / "run.log").is_file():
            return self.incomplete(directory, "Centre run log is not available")
        return True

    def complete_sideband(self, directory):
        """Keep partial transfers/running jobs out of a published snapshot.

        A complete set still goes through all strict scientific checks below;
        a failed numerical invariant must abort export, never silently pass.
        """
        energy = float(directory.name[2:])
        centers = [p for p in directory.parent.parent.glob("E*") if p.is_dir()]
        center = min(centers, key=lambda p: abs(float(p.name[1:]) - energy)) if centers else None
        if center is None or abs(float(center.name[1:]) - energy) >= 1e-3:
            return self.incomplete(directory, "Matching centre run is not available")
        if not self.complete_run(center):
            return self.incomplete(directory, "Matching centre run is incomplete")
        identity_path = directory / "identity_tool.log"
        if not identity_path.is_file():
            return self.incomplete(directory, "Overlap-identity gate report is not available")
        identity = self.add(identity_path).read_text()
        gates = re.search(r"(\d+) gates, (\d+) failed", identity)
        if not gates:
            return self.incomplete(directory, "Overlap-identity gate report is incomplete")
        require(int(gates[2]) == 0 and int(gates[1]) > 0,
                "Overlap-identity gates did not pass: " + str(directory))
        try:
            required = [Path(self.reader.amplitude_file(str(directory), q, s))
                        for q in self.reader.COMPONENTS for s in self.reader.COMPONENTS]
        except FileNotFoundError:
            return self.incomplete(directory, "Incomplete nine-component amplitude set")
        required += [directory / ("lab_expansion_%d.h5" % angle) for angle in (0, 90)]
        missing = [p.name for p in required if not p.is_file()]
        for name in ("Oend", "Nend", "perp"):
            stem = "direction_%s_expansion" % name
            if not (directory / (stem + ".h5")).is_file() and not (directory / (stem + ".log")).is_file():
                missing.append(stem + ".h5 or refusal log")
        if missing:
            return self.incomplete(directory, "Missing products: " + ", ".join(missing))
        self.checks["sideband_identity_gates"] += 1
        return True

    def pole(self, directory):
        text = self.add(directory / "run.log").read_text(errors="replace")
        match = FIT.search(text)
        require(match is not None, "Missing K-matrix fit in " + str(directory))
        distance = min(abs(float(match["emax"]) - math.pi / 2), abs(float(match["emin"]) + math.pi / 2))
        return {"at_pole": distance < 1e-3, "pole_distance_rad": distance}

    def harmonics(self, size, theta, phi):
        lmax = math.isqrt(size) - 1
        require((lmax + 1) ** 2 == size, "Non-square channel count")
        return self.ca.real_harmonics(lmax, self.ca.unit_vectors(theta, phi))[0]

    def dipole(self, path, route, channel):
        with self.read(path) as f:
            for stamp in ("partial_wave_phase_applied", "coulomb_phase_applied",
                          "normalization_energy_normalized", "conversion_plus_convention", "gauge_length"):
                require(float(f[stamp][()]) == 1, "Invalid dipole convention: " + str(path))
            require("constraint_set_hole" not in f, "Hole-set diagnostic is not a production sample")
            require("recovery_full_width_control" not in f, "Recovery control is not a production sample")
            d = f["D_real"][()] + 1j * f["D_imag"][()]
            require(d.shape == (3, (int(f["l_cont"][()]) + 1) ** 2), "Invalid dipole dimensions")
            energy = float(f["energy"][()]) * EV
            photon = float(f["omega_hartree"][()]) * EV
            require(abs(photon - energy - IP[channel]) < 1e-8, "Unexpected ionization threshold")
            sigma = {axis: float(f["sigma_" + axis + "_bohr2"][()]) * MB for axis in ("x", "y", "z")}
            sigma["avg"] = float(f["sigma_megabarn"][()])
            prefactors = np.array([sigma[axis] / np.sum(abs(d[i]) ** 2) for i, axis in enumerate(("x", "y", "z"))])
            relative = float(np.ptp(prefactors) / np.mean(prefactors))
            require(relative < 1e-10, "Cross-section prefactors disagree")
            require(abs(np.mean([sigma[a] for a in ("x", "y", "z")]) - sigma["avg"]) < 1e-10,
                    "Orientation-averaged cross section disagrees")
            self.checks["dipole_prefactors"] += 1
            self.worst["dipole_prefactor_relative"] = max(self.worst["dipole_prefactor_relative"], relative)
            point = {"energy_ev": energy, "photon_ev": photon, "sigma_mb": sigma,
                     "beta": float(f["beta"][()]), "route": route, "source": self.relative(path),
                     "prefactor_mb": float(np.mean(prefactors)), **self.pole(path.parent)}
        kept, l, m, dropped = sparse(d)
        point.update({"l": l, "m": m, "D": pairs(d[:, kept]), "dropped_weight_fraction": dropped})
        return point, d

    def sideband(self, directory, route, channel):
        for p in directory.glob("M_q*.h5"):
            self.add(p)
        record = self.reader.read_sideband(str(directory), "expansion")
        require(record["constraint_set"] == "ion", "Mixed constraint-set data")
        energy = record["energy_final"] * EV
        order = int(round((energy + IP[channel]) / (record["omega"] * EV)))
        require(abs(order * record["omega"] * EV - energy - IP[channel]) < 1e-7, "Sideband order mismatch")
        lmax = math.isqrt(record["emi"].shape[-1]) - 1
        phase = self.reader.final_state_phase(lmax, record["eta"])
        absorption = record["abs"] * phase
        emission = record["emi"] * phase
        kept, l, m, dropped = sparse(np.stack([absorption, emission]))
        pole_dir = min(directory.parent.parent.glob("E*"), key=lambda p: abs(float(p.name[1:]) - energy))
        require(abs(float(pole_dir.name[1:]) - energy) < 1e-3, "Missing sideband center run")
        sb = {"order": order, "energy_ev": energy, "photon_ev": order * record["omega"] * EV,
              "route": route, "source": self.relative(directory), "origin": "expansion",
              "omega_hartree": record["omega"], "l": l, "m": m,
              "M_abs": pairs(absorption[:, :, kept]), "M_emi": pairs(emission[:, :, kept]),
              "dropped_weight_fraction": dropped, "lab": {}, **self.pole(pole_dir)}
        for angle in (0, 90):
            with self.read(directory / ("lab_expansion_%d.h5" % angle)) as f:
                require(float(f["dipole_origin"][()]) == 0, "Unexpected lab dipole origin")
                require(abs(float(f["energy_final"][()]) - record["energy_final"]) < 1e-12, "Lab energy mismatch")
                values = {k: float(f[k][()]) for k in ("tau_R_as", "tau_1_as", "tau_cc_as", "fringe_depth")}
                interference = complex(float(f["interference_real"][()]), float(f["interference_imag"][()]))
                residual = abs(np.angle(interference) * AS / (2 * record["omega"]) - values["tau_R_as"])
                require(residual < 1e-9, "Stored lab interference and delay disagree")
                require(abs(values["tau_R_as"] - values["tau_1_as"] - values["tau_cc_as"]) < 1e-9,
                        "Stored lab delay split disagrees")
                self.checks["lab_interference_delays"] += 1
                self.worst["lab_delay_as"] = max(self.worst["lab_delay_as"], residual)
                sb["lab"][str(angle)] = values
        for name, theta, phi, eps in (("Oend", 0, 0, [0, 0, 1]),
                                      ("Nend", math.pi, 0, [0, 0, 1]),
                                      ("perp", math.pi / 2, 0, [1, 0, 0])):
            y = self.harmonics(absorption.shape[-1], theta, phi)
            result = two_values(absorption, emission, y, eps, record["omega"])
            direction_path = directory / ("direction_%s_expansion.h5" % name)
            if not direction_path.is_file():
                log = self.add(directory / ("direction_%s_expansion.log" % name)).read_text()
                require("REFUSED" in log and "node" in log and not result["valid"],
                        "Missing directional reference without a matching node refusal")
                self.checks["stored_direction_refusals"] += 1
                continue
            with self.read(direction_path) as f:
                require(abs(float(f["direction_theta"][()]) - theta) < 1e-12, "Direction theta mismatch")
                expected_delay = float(f["tau_R_direction_as"][()])
                expected_abs = float(f["direction_modulus_abs"][()])
                expected_emi = float(f["direction_modulus_emi"][()])
            delay_error = abs(wrapped_delay_difference(result["raw_delay_as"], expected_delay, record["omega"]))
            strength_error = max(abs(result["modulus_abs"] - expected_abs) / max(expected_abs, 1e-100),
                                 abs(result["modulus_emi"] - expected_emi) / max(expected_emi, 1e-100))
            require(delay_error < 1e-7 and strength_error < 1e-8, "Stored direction validation failed: " + str(directory))
            self.checks["stored_direction_delays"] += 1
            self.checks["stored_direction_strengths"] += 1
            self.worst["direction_delay_as"] = max(self.worst["direction_delay_as"], delay_error)
            self.worst["direction_strength_relative"] = max(self.worst["direction_strength_relative"], strength_error)
        return sb, absorption, emission

    def channel(self, channel):
        root = self.root / DATA
        selected = {}
        for tree in [channel] + ([channel + "OFF"] if channel in ("b", "c") else []):
            route = "box" if tree.endswith("OFF") or tree == "X" else "far field"
            for path in sorted((root / tree).glob("E*/dipole.h5")):
                if not self.complete_run(path.parent):
                    continue
                with self.read(path) as f:
                    energy = float(f["energy"][()]) * EV
                # The main route takes precedence at overlapping redo energies.
                if any(abs(energy - old) < 1e-6 for old in selected):
                    continue
                selected[energy] = (path, route)
        points = []
        for energy, (path, route) in sorted(selected.items()):
            point, d = self.dipole(path, route, channel)
            index = len(points)
            points.append(point)
            for theta, phi, alpha, beta in GEOMETRIES:
                eps = polarization(alpha, beta)
                a = np.dot(eps, d) @ self.harmonics(d.shape[-1], theta, phi)
                self.tests["onePhoton"].append({"channel": channel, "index": index, "theta": theta,
                    "phi": phi, "eps": eps.tolist(), "expected": float(abs(a) ** 2 * point["prefactor_mb"])})
        sidebands = []
        for tree in [channel] + ([channel + "OFF"] if channel in ("b", "c") else []):
            route = "box" if tree.endswith("OFF") or tree == "X" else "far field"
            for directory in sorted((root / tree / "sidebands").glob("Ef*")):
                if directory.is_dir() and self.complete_sideband(directory):
                    sb, absorption, emission = self.sideband(directory, route, channel)
                    sidebands.append((sb, absorption, emission))
        sidebands.sort(key=lambda row: row[0]["order"])
        require(len(set(sb[0]["order"] for sb in sidebands)) == len(sidebands), "Duplicate sideband")
        for index, (sb, absorption, emission) in enumerate(sidebands):
            for theta, phi, alpha, beta in GEOMETRIES:
                eps = polarization(alpha, beta)
                y = self.harmonics(absorption.shape[-1], theta, phi)
                expected = two_values(absorption, emission, y, eps, sb["omega_hartree"])
                self.tests["twoPhoton"].append({"channel": channel, "index": index, "theta": theta,
                    "phi": phi, "eps": eps.tolist(), "expected": {k: expected[k] for k in
                    ("delay_as", "strength", "contrast", "valid")}})
        return {"label": LABEL[channel], "ip_ev": IP[channel], "onePhoton": points,
                "sidebands": [row[0] for row in sidebands]}


def sparse(values):
    values = np.asarray(values)
    peak = np.max(np.abs(values), axis=tuple(range(values.ndim - 1)))
    require(np.all(np.isfinite(values)) and np.max(peak) > 0, "Invalid or zero amplitude")
    kept = np.flatnonzero(peak > THRESHOLD * np.max(peak))
    dropped = float(np.sum(abs(values[..., peak <= THRESHOLD * np.max(peak)]) ** 2) / np.sum(abs(values) ** 2))
    require(dropped < 1e-20, "Too much discarded amplitude weight")
    l = np.floor(np.sqrt(kept)).astype(int)
    return kept, l.tolist(), (kept - l * l - l).tolist(), dropped


def pairs(values):
    return np.stack([values.real, values.imag], axis=-1).tolist()


def polarization(alpha, beta):
    return np.array([math.sin(beta) * math.cos(alpha), math.sin(beta) * math.sin(alpha), math.cos(beta)])


def two_values(absorption, emission, harmonics, eps, omega):
    a = np.einsum("q,s,qsc->c", eps, eps, absorption)
    e = np.einsum("q,s,qsc->c", eps, eps, emission)
    terms_a, terms_e = a * harmonics, e * harmonics
    amp_a, amp_e = np.sum(terms_a), np.sum(terms_e)
    ia, ie = float(abs(amp_a) ** 2), float(abs(amp_e) ** 2)
    mean_a, mean_e = float(np.sum(abs(a) ** 2) / (4 * math.pi)), float(np.sum(abs(e) ** 2) / (4 * math.pi))
    ca = float(abs(amp_a) / np.sum(abs(terms_a))) if np.sum(abs(terms_a)) > 0 else 0.0
    ce = float(abs(amp_e) / np.sum(abs(terms_e))) if np.sum(abs(terms_e)) > 0 else 0.0
    valid = ca > CONDITION_MIN and ce > CONDITION_MIN and ia > INTENSITY_MIN * mean_a and ie > INTENSITY_MIN * mean_e
    delay = float(np.angle(amp_e * np.conj(amp_a)) * AS / (2 * omega))
    return {"delay_as": delay if valid else None, "raw_delay_as": delay, "strength": (ia + ie) / 2,
            "contrast": float(2 * abs(amp_a) * abs(amp_e) / (ia + ie)) if valid else None,
            "valid": bool(valid), "modulus_abs": float(abs(amp_a)), "modulus_emi": float(abs(amp_e))}


def wrapped_delay_difference(actual, expected, omega):
    return np.angle(np.exp(1j * (actual - expected) * 2 * omega / AS)) * AS / (2 * omega)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=Path("assets/viz/no-amplitude-data.js"))
    args = parser.parse_args()
    export = Export(args.source_root.resolve())
    channels = {name: export.channel(name) for name in ("b", "c", "X")}
    payload = {"meta": {"schema_version": 1, "campaign": "NO CP2026 Fig. 3, exported local snapshot",
        "source_prefix": DATA.as_posix(), "angular_basis": "orthonormal real harmonics; no Condon–Shortley phase",
        "dipole_origin": "expansion", "two_photon_phase": "(-i)^l exp(i arg Gamma(l+1+i eta_final)), preapplied",
        "two_photon_components": "all nine Cartesian XUV × IR pairs; parallel fields",
        "channel_threshold": THRESHOLD, "node_condition_min": CONDITION_MIN,
        "node_intensity_relative_min": INTENSITY_MIN, "energy_policy": "discrete computed energies; no energy interpolation or derivatives",
        "lab_acceptance": "random molecular orientations, all electron directions collected (4pi)",
        "one_photon_delay_note": "No validated directional derivative export is available. Stored independent-angle averages are not substituted for along-polarization delays.",
        "excluded_incomplete": export.excluded,
        "validation": {"checks": export.checks, "worst_residuals": export.worst}, "sources": export.manifest()},
        "channels": channels, "selftests": export.tests}
    rendered = "/* Generated by scripts/export_no_amplitudes.py; scientific sources are read-only. */\nwindow.NO_AMPLITUDE_DATA=" + json.dumps(payload, separators=(",", ":"), ensure_ascii=False, allow_nan=False) + ";\n"
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(rendered)
    print(json.dumps({"output_bytes": len(rendered.encode()), "channels": {k: {"dipoles": len(v["onePhoton"]),
        "sidebands": len(v["sidebands"])} for k, v in channels.items()}, "validation": payload["meta"]["validation"],
        "browser_vectors": {k: len(v) for k, v in export.tests.items()}, "excluded_incomplete": export.excluded}, indent=2))


if __name__ == "__main__":
    main()
