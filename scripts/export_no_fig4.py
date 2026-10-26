#!/usr/bin/env python3
"""Export NO Fig. 4 paper/reference curves and eMOL directional cross sections.

No eMOL Wigner delay is substituted from an angle-integrated calculation or
inferred from the sparse browser grid. Numerical sources remain read-only.
Requires numpy and h5py plus the campaign's existing analysis library.
"""

import argparse
import hashlib
import json
import math
from pathlib import Path
import re
import sys

sys.dont_write_bytecode = True

import h5py
import numpy as np

from export_no_paper import CAMPAIGN, REVIEW, FIT, Sources, load_module, require

CHANNELS = {"b": ("b3Pi", "b ³Π", 16.56), "c": ("c3Pi", "c ³Π", 21.72),
            "X": ("X1Sigma+", "X ¹Σ⁺", 9.26), "A": ("A1Pi", "A ¹Π", 18.32)}
EV = 27.211386245988
MB = 28.0028520539


def finite(value):
    result = float(value)
    require(math.isfinite(result), "Nonfinite Figure 4 value")
    return result


def paper_rows(source, state, panel, field):
    path = source.root / CAMPAIGN / "wf1/raster_b" / ("fig4%s_%s_resampled_0p1eV.csv" % (panel, state))
    rows = [{"photon": finite(r["photon_energy_eV"]), "value": finite(r[field]),
             "flag": r["flag"], "kinds": r["kinds_in_window"]} for r in source.csv(path)]
    require(all(a["photon"] < b["photon"] for a, b in zip(rows, rows[1:])), "Unsorted paper curve")
    require(all(r["flag"] in ("local", "bridged") for r in rows), "Unknown digitization flag")
    return rows


def reference_rows(source, channel, convention):
    suffix = "fresh" if convention == "complete" else "xz_diagnostic"
    rows = []
    for r in source.csv(source.root / REVIEW / "results" / ("fig4_%s_%s.csv" % (channel, suffix))):
        directional = finite(r["sigma_LF0_Mb_sr"])
        scaled = 4 * math.pi * directional
        require(abs(directional - finite(r["sigma_total_Mb"]) * (1 + finite(r["beta_coherent"])) / (4 * math.pi)) < 1e-8,
                "Reference directional cross section does not close against sigma and beta")
        if convention == "omitted":
            require(abs(scaled - finite(r["diagnostic_4pi_sigma_LF_Mb"])) < 1e-10, "Reference diagnostic scale differs")
        rows.append({"photon": finite(r["photon_ev"]), "energy": finite(r["energy_ev"]),
                     "sigma": scaled, "directional_sigma": directional, "tau": finite(r["tau_LF0_as"])})
    return rows


def fine_rows(source):
    result = {channel: {"complete": [], "omitted": []} for channel in CHANNELS}
    for r in source.csv(source.root / REVIEW / "results/fine_checkpoints.csv"):
        convention = {"xyz": "complete", "xz": "omitted"}[r["subset"]]
        require(finite(r["phase_guard_endpoint_fraction"]) == 0 and finite(r["phase_guard_halfstep_fraction"]) == 0,
                "Fine reference checkpoint failed its phase guards")
        directional = finite(r["sigma_LF_Mb_sr"])
        scaled = finite(r["sigma_LF_times4pi_diagnostic"])
        require(abs(scaled - 4 * math.pi * directional) < 1e-10, "Fine reference scale mismatch")
        result[r["state"]][convention].append({
            "photon": finite(r["photon_eV"]), "sigma": scaled, "directional_sigma": directional,
            "tau": finite(r["tau_complex_as"]), "tau_phase": finite(r["tau_phase_as"]),
            "stencil_halfwidth_ev": finite(r["stencil_halfwidth_eV"]), "source_dataset": r["source_dataset"],
        })
    for conventions in result.values():
        for rows in conventions.values():
            rows.sort(key=lambda r: r["photon"])
    return result


def emol_rows(source, browser_amplitudes):
    library = source.add(source.root / CAMPAIGN / "wf1/library/comphys_analysis.py")
    ca = load_module("no_fig4_analysis", library)
    text = browser_amplitudes.read_text()
    match = re.search(r"window\.NO_AMPLITUDE_DATA\s*=\s*(.*);\s*$", text, re.DOTALL)
    require(match is not None, "Missing NO amplitude assignment")
    amplitude = json.loads(match.group(1))
    source_hashes = {row["path"]: row["sha256"] for row in amplitude["meta"]["sources"]}
    result = {channel: {"complete": [], "omitted": []} for channel in CHANNELS}
    quadrature = {}
    worst = 0.0
    count = 0
    for channel, entries in amplitude["channels"].items():
        for point in entries["onePhoton"]:
            relative = str(Path(amplitude["meta"]["source_prefix"]) / point["source"])
            path = source.add(source.root / relative)
            require(hashlib.sha256(path.read_bytes()).hexdigest() == source_hashes[relative],
                    "Amplitude source changed since the browser export")
            require(re.search(r"\brc 0\b", source.text(path.parent / "RUN_DONE")) is not None,
                    "Unsuccessful eMOL production run")
            fit = FIT.search(source.text(path.parent / "run.log"))
            require(fit is not None, "Missing eMOL pole diagnostic")
            pole_distance = min(abs(float(fit["emax"]) - math.pi / 2), abs(float(fit["emin"]) + math.pi / 2))
            require(point["at_pole"] == (pole_distance < 1e-3), "Pole flag differs from the source log")
            route = "box" if path.parent.parent.name.endswith("OFF") or channel == "X" else "far field"
            require(route == point["route"], "Route differs from production source")
            with h5py.File(path) as handle:
                require("constraint_set_hole" not in handle, "Hole-set diagnostic cannot join the production curve")
                for key in ("partial_wave_phase_applied", "coulomb_phase_applied", "normalization_energy_normalized",
                            "conversion_plus_convention", "gauge_length"):
                    require(float(handle[key][()]) == 1, "Unexpected dipole convention")
                d = handle["D_real"][()] + 1j * handle["D_imag"][()]
                sigma = float(handle["sigma_megabarn"][()])
                beta = float(handle["beta"][()])
                energy = float(handle["energy"][()]) * EV
                photon = float(handle["omega_hartree"][()]) * EV
                sigma_q = np.array([float(handle["sigma_" + axis + "_bohr2"][()]) * MB for axis in ("x", "y", "z")])
            require(abs(photon - energy - CHANNELS[channel][2]) < 1e-8, "Incorrect eMOL ionization threshold")
            lmax = math.isqrt(d.shape[-1]) - 1
            require(d.shape == (3, (lmax + 1) ** 2), "Unexpected dipole dimensions")
            prefactors = sigma_q / np.sum(abs(d) ** 2, axis=1)
            require(np.ptp(prefactors) / np.mean(prefactors) < 1e-10, "Polarization prefactors differ")
            if lmax not in quadrature:
                directions, weights = ca.sphere_product_rule(*ca.exact_rule_for_degree(2 * (lmax + 1)))
                require(abs(sum(weights) - 4 * math.pi) < 1e-10, "Unexpected quadrature normalization")
                quadrature[lmax] = directions, weights, ca.real_harmonics(lmax, directions)
            directions, weights, y = quadrature[lmax]
            components = (d @ y.T).T * directions
            complete = np.sum(components, axis=1)
            omitted = components[:, 0] + components[:, 2]
            factor = float(np.mean(prefactors)) / (4 * math.pi)
            values = {"complete": factor * float(np.sum(weights * abs(complete) ** 2)),
                      "omitted": factor * float(np.sum(weights * abs(omitted) ** 2))}
            expected = sigma * (1 + beta) / (4 * math.pi)
            residual = abs(values["complete"] - expected) / abs(expected)
            worst = max(worst, residual)
            require(residual < 1e-8, "eMOL quadrature does not close against sigma and beta")
            for convention, directional in values.items():
                result[channel][convention].append({"photon": photon, "energy": energy, "sigma": 4 * math.pi * directional,
                    "directional_sigma": directional, "route": point["route"], "at_pole": point["at_pole"],
                    "source": relative})
            count += 1
    require(count == 35, "Incomplete eMOL cross-section coverage")
    return result, {"raw_dipoles_checked": count, "full_xyz_sigma_beta_identity_max_relative": worst,
                    "quadrature": "Exact real-harmonic sphere rule for polynomial degree 2(lmax+1)",
                    "amplitude_export_sha256": hashlib.sha256(browser_amplitudes.read_bytes()).hexdigest()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", type=Path, required=True)
    root = Path(__file__).resolve().parents[1]
    parser.add_argument("--amplitudes", type=Path, default=root / "assets/viz/no-amplitude-data.js")
    parser.add_argument("--output", type=Path, default=root / "assets/viz/no-fig4-data.js")
    args = parser.parse_args()
    source = Sources(args.source_root.expanduser().resolve())
    emol, checks = emol_rows(source, args.amplitudes)
    fine = fine_rows(source)
    channels = {}
    for channel, (state, label, threshold) in CHANNELS.items():
        channels[channel] = {"label": label, "ip_ev": threshold,
            "paper": {"sigma": paper_rows(source, state, "a", "cross_section_Mb_per_sr"),
                      "delay": paper_rows(source, state, "b", "wigner_delay_as")},
            "reference": {convention: reference_rows(source, channel, convention) for convention in ("complete", "omitted")},
            "fine": fine[channel], "emol": emol[channel]}
    source.add(source.root / REVIEW / "REPORT.txt")
    source.add(source.root / "emol/docs/CommunicationsPhysics_2026.pdf")
    calibration = json.loads(source.text(source.root / CAMPAIGN / "wf1/raster_b/calibration.json"))
    data = {
        "meta": {"figure": "4", "doi": "10.1038/s42005-026-02911-1", "bond_length_angstrom": 1.15,
            "geometry": "Random molecular orientations; laboratory electron detection along the polarization",
            "sigma_field": "sigma = 4π × directional_sigma, an explicit ordinate-normalization diagnostic (Mb)",
            "directional_sigma_field": "Physical directional cross section dσ/dΩ at θ_lab=0 (Mb/sr)",
            "tau_field": "Laboratory-frame, cross-section-weighted one-photon Wigner delay (as)",
            "paper_sigma_axis_label": "Cross section (Mb/sr)", "paper_sigma_caption": "total photoionization cross sections",
            "paper_axes": {quantity: {axis: calibration["fig4" + panel][axis]["frame_values"] for axis in ("x", "y")}
                           for quantity, panel in (("sigma", "a"), ("delay", "b"))},
            "emol_wigner_available_under_common_convention": False,
            "emol_wigner_note": "No validated eMOL derivative export matches the required along-polarization detection geometry. The existing stored mf-average artifacts integrate emission and polarization angles independently, despite their along-eps filenames. Those averages and 4π-integrated delays are not substituted for Fig. 4 Wigner delays.",
            "validation": checks},
        "channels": channels,
        "notes": [
            "The paper's Fig. 4 contains calculations, not experimental points: cross section (a) and one-photon Wigner delay (b), at fixed nuclei R(NO)=1.15 Å.",
            "The paper labels its cross-section axis Mb/sr while its caption says total. The 4π-scaled comparison is an explicit normalization diagnostic, not a physical correction and not integration over electron directions. Physical Mb/sr mode must not overlay the incompatible paper ordinate.",
            "Omitting the XUV y component is a diagnostic selection. No phase, energy shift or fitted scaling is applied.",
            "The independent reference covers X, b, A and c. Its broad curves use a 0.5 eV grid; the separate open checkpoint markers use local fine stencils and higher cutoff. They do not establish global derivative convergence.",
            "eMOL cross-section markers use exact orientation quadrature of the raw amplitudes at 35 calculated energies, with full x,y,z or literal y omission. The full-component result is independently checked against σtotal(1+β)/(4π). The present eMOL campaign does not contain A-channel amplitudes.",
            "eMOL Wigner delays are not shown: no validated derivative export matches the required directional average. No derivative is invented from the sparse browser grid, and stored independent-angle or 4π-integrated averages are not used as along-polarization delays.",
            "Paper curves are digitized. Bridged segments are reconstructed; missing intervals, including the unresolved A-delay tail, must remain gaps.",
        ],
        "provenance": {"hash_algorithm": "SHA-256", "hashfile": source.manifest(),
            "source_root_description": "mpi_static_exchangeHF checkout; all paths are relative",
            "paper_digitization": str(CAMPAIGN / "wf1/raster_b"), "reference": str(REVIEW / "results")},
    }
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    require(str(source.root) not in payload, "Private path leaked into export")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text("// Generated by scripts/export_no_fig4.py; numerical sources are read-only.\nwindow.NO_FIG4_DATA=" + payload + ";\n")
    print(json.dumps({"bytes": args.output.stat().st_size, "channels": list(channels), "validation": checks,
                      "source_files": len(data["provenance"]["hashfile"])}, indent=2))


if __name__ == "__main__":
    main()
