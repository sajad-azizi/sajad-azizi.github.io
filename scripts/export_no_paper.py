#!/usr/bin/env python3
"""Export the local NO Fig. 3 campaign without modifying its scientific sources.

Requires numpy, scipy and h5py, plus the existing validated analysis library.
The source root is the mpi_static_exchangeHF checkout, not its emol subdirectory.
Every export reruns the reader validation and checks all production sidebands
against their nine raw amplitude files. No cluster access is needed.

Example:
    python -B scripts/export_no_paper.py --source-root /path/to/mpi_static_exchangeHF
"""

import argparse
import contextlib
import csv
import hashlib
import importlib.util
import io
import json
import math
from pathlib import Path
import re
import sys


CAMPAIGN = Path("far_field_scratch/no/comphys2026")
REVIEW = Path("emol/docs/epolyscat_cp2026_independent_20261021")
OMEGA_EV = 1.549802
THRESHOLDS = {"b": 16.56, "c": 21.72, "X": 9.26}
POLE_DISTANCE = 1e-3
READING = re.compile(
    r"Ef(?P<directory>[0-9.]+) expansion\s+E_f (?P<ef>[0-9.]+) eV"
    r" \| along eps: complete\s+(?P<complete>[-+0-9.]+) as"
    r" \(contrast (?P<contrast>[0-9.]+)\), y omitted\s+(?P<omitted>[-+0-9.]+) as"
    r" \((?P<omitted_contrast>[0-9.]+)\) \| 4pi\s+(?P<fourpi>[-+0-9.]+) as"
    r" \| L <= (?P<lmax>[0-9]+) \| constraint set (?P<constraint>[^\n]+)"
)
FIT = re.compile(
    r"^\[fused\] fit K symmetry (?P<ksym>[0-9.e+-]+) \| S unitarity [0-9.e+-]+"
    r" \| eigenphase min (?P<emin>[-+0-9.]+) max (?P<emax>[-+0-9.]+)", re.MULTILINE
)


def require(condition, message):
    if not condition:
        raise ValueError(message)


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


class Sources:
    def __init__(self, root):
        self.root = root
        self.files = set()

    def add(self, path):
        path = path.resolve()
        path.relative_to(self.root)
        require(path.is_file(), "Missing source: %s" % path)
        self.files.add(path)
        return path

    def text(self, path):
        return self.add(path).read_text(errors="replace")

    def csv(self, path):
        with self.add(path).open(newline="") as handle:
            return list(csv.DictReader(handle))

    def manifest(self):
        return [
            {"path": str(path.relative_to(self.root)),
             "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
            for path in sorted(self.files)
        ]


def validated_reader(source):
    library = source.root / CAMPAIGN / "wf1/library/comphys_analysis.py"
    reader_path = source.root / CAMPAIGN / "analysis/fig3_reader/emol_fig3_reader.py"
    # Preload the supplied library so the legacy reader's fixed sys.path entry
    # cannot make an export silently read another checkout's analysis library.
    load_module("comphys_analysis", source.add(library))
    reader = load_module("no_validated_fig3_reader", source.add(reader_path))
    reader.PRX_SIDEBAND = str(
        source.root / "emol/docs/no_c3pi_rabbitt_review/data/emol/sidebands/Ef6.91172"
    )
    for path in Path(reader.PRX_SIDEBAND).glob("*.h5"):
        source.add(path)
    output = io.StringIO()
    with contextlib.redirect_stdout(output):
        status = reader.validate()
    report = output.getvalue()
    checks = report.count("-- PASS")
    require(status == 0 and "VALIDATION PASSED" in report and checks == 15,
            "Validated reader failed its V1/V2/V3/V4 checks")
    print("Reader validation: %d checks passed" % checks, flush=True)
    return reader, checks


def campaign_channel(source, reader, channel):
    data_root = source.root / CAMPAIGN / "emol_data/cp26fig3"
    trees = [channel] + ([channel + "OFF"] if channel in ("b", "c") else [])
    readings = {}
    max_delay_residual = 0.0
    max_contrast_residual = 0.0
    for tree in trees:
        sidebands = data_root / tree / "sidebands"
        for saved in sorted(sidebands.glob("fig3_read_*.out")):
            for match in READING.finditer(source.text(saved)):
                ef = float(match["ef"])
                order = int(round((ef + THRESHOLDS[channel]) / OMEGA_EV))
                require(abs(order * OMEGA_EV - THRESHOLDS[channel] - ef) < 1e-5,
                        "Sideband energy and threshold do not match")
                require(order not in readings, "Duplicate %s SB%d reading" % (channel, order))
                require(match["constraint"] == "ion", "Mixed production constraint set")
                sideband = sidebands / ("Ef" + match["directory"])
                centre = data_root / tree / ("E%.6g" % ef)
                done = source.text(centre / "RUN_DONE")
                require(re.search(r"\brc 0\b", done) is not None, "Unsuccessful centre run")
                completed = re.search(r"\b\d{4}-\d{2}-\d{2}T[0-9:+-]+", done)
                require(completed is not None, "Missing centre-run completion timestamp")
                fit = FIT.search(source.text(centre / "run.log"))
                require(fit is not None, "Missing K-pole diagnostic")
                pole_distance = min(abs(float(fit["emax"]) - math.pi / 2),
                                    abs(float(fit["emin"]) + math.pi / 2))
                identity = source.text(sideband / "identity_tool.log")
                require(re.search(r"\d+ gates, 0 failed", identity) is not None,
                        "Sideband overlap identity did not pass")
                for q in reader.COMPONENTS:
                    for s in reader.COMPONENTS:
                        source.add(Path(reader.amplitude_file(str(sideband), q, s)))

                record = reader.read_sideband(str(sideband), "expansion")
                require(record["constraint_set"] == "ion", "Unexpected raw constraint set")
                require(abs(record["energy_final"] * reader.HARTREE_EV - ef) < 5.01e-7,
                        "Raw sideband energy differs from saved reader output")
                require(abs(record["omega"] * reader.HARTREE_EV - OMEGA_EV) < 1e-10,
                        "Raw IR frequency differs from the campaign")
                lmax = reader.ca.l_max_from_channels(record["emi"].shape[-1])
                require(lmax == int(match["lmax"]), "Raw and saved partial-wave cutoffs differ")
                phase = reader.final_state_phase(lmax, record["eta"])
                complete, contrast = reader.along_polarisation(record, lmax, phase)
                omitted, omitted_contrast = reader.along_polarisation(record, lmax, phase, drop_y=True)
                fourpi = reader.lab_integrated_parallel(record)
                for name, actual in (("complete", complete), ("omitted", omitted), ("fourpi", fourpi)):
                    residual = abs(actual - float(match[name]))
                    max_delay_residual = max(max_delay_residual, residual)
                    require(residual <= 5.01e-5, "Raw %s SB%d %s does not reproduce saved reading" %
                            (channel, order, name))
                for name, actual in (("contrast", contrast), ("omitted_contrast", omitted_contrast)):
                    residual = abs(actual - float(match[name]))
                    max_contrast_residual = max(max_contrast_residual, residual)
                    require(residual <= 5.01e-5, "Raw contrast differs from saved reading")

                readings[order] = {
                    "order": order, "ef": ef, "photon": round(order * OMEGA_EV, 6),
                    **{key: float(match[key]) for key in ("complete", "omitted", "fourpi", "contrast")},
                    "omitted_contrast": float(match["omitted_contrast"]),
                    "route": "box" if tree.endswith("OFF") or channel == "X" else "far field",
                    "pole_distance": pole_distance, "fit_ksym": float(fit["ksym"]),
                    "at_pole": pole_distance < POLE_DISTANCE, "constraint_set": "ion",
                    "completed_at": completed.group(0),
                    "source": str(sideband.relative_to(source.root)),
                    "reader_output": str(saved.relative_to(source.root)),
                }
                print("Raw amplitudes verified: %s SB%d" % (channel, order), flush=True)
    expected = [22, 24, 26, 28] if channel == "c" else [18, 20, 22, 24, 26, 28]
    require(sorted(readings) == expected, "Unexpected sideband coverage for " + channel)
    return [readings[o] for o in sorted(readings)], max_delay_residual, max_contrast_residual


def paper_comparison(source, channel, channels):
    panel = "a" if channel == "b" else "b"
    raster = source.root / CAMPAIGN / "wf1/raster_b"
    measured = []
    for row in source.csv(raster / ("fig3%s_measured_points.csv" % panel)):
        measured.append({"order": int(row["sideband"].removeprefix("SB")),
                         "photon": float(row["photon_energy_eV"]),
                         "value": float(row["relative_delay_as"]),
                         "err_up": float(row["err_up_as"]), "err_down": float(row["err_down_as"])})
    theory = []
    for row in source.csv(raster / ("fig3%s_theory_line_resampled_0p1eV.csv" % panel)):
        require(row["flag"] in ("local", "bridged"), "Unknown paper curve reconstruction flag")
        theory.append({"photon": float(row["photon_energy_eV"]), "value": float(row["relative_delay_as"]),
                       "flag": row["flag"], "kinds": row["kinds_in_window"]})

    references = {}
    for file, key in (("fig3_sidebands_fresh.csv", "complete"),
                      ("fig3_xz_diagnostic_sidebands_fresh.csv", "omitted")):
        for row in source.csv(source.root / REVIEW / "results" / file):
            if row["state"] != channel:
                continue
            order = int(row["sideband"])
            photon = float(row["photon_ev"])
            ref = references.setdefault(order, {"order": order, "photon": photon})
            require(ref["photon"] == photon and key not in ref, "Inconsistent reference sideband")
            ref[key] = float(row["relative_as"])
            ref["molecular" if key == "complete" else "molecular_omitted"] = float(row["molecular_relative_as"])
            ref["cc" if key == "complete" else "cc_omitted"] = float(row["cc_relative_as"])
            ref["coherence" if key == "complete" else "coherence_omitted"] = float(row["coherence"])
            require(abs(ref[key] - float(row["molecular_relative_as"]) - float(row["cc_relative_as"])) < 1e-10,
                    "Reference molecular/cc split does not sum to the total")
    x = {row["order"]: row for row in channels["X"]}
    emol = []
    for row in channels[channel]:
        baseline = x[row["order"]]
        require(row["photon"] == baseline["photon"], "Relative delay compared at different photon energies")
        emol.append({
            "order": row["order"], "photon": row["photon"],
            **{key: round(row[key] - baseline[key], 4) for key in ("complete", "omitted", "fourpi")},
            "at_pole": row["at_pole"] or baseline["at_pole"], "route": row["route"],
            "reference_route": baseline["route"], "pole_distance": row["pole_distance"],
            "fit_ksym": row["fit_ksym"], "ef": row["ef"], "reference_ef": baseline["ef"],
        })
    require(sorted(references) == [row["order"] for row in emol], "Incomplete external comparison")
    require(sorted(row["order"] for row in measured) == sorted(references), "Incomplete measured comparison")
    return {"emol": emol, "measured": measured, "theory": theory,
            "reference": [references[o] for o in sorted(references)]}


def export(source_root):
    source = Sources(source_root)
    reader, reader_checks = validated_reader(source)
    channels = {}
    delay_residual = contrast_residual = 0.0
    for channel in ("b", "c", "X"):
        channels[channel], delay_error, contrast_error = campaign_channel(source, reader, channel)
        delay_residual = max(delay_residual, delay_error)
        contrast_residual = max(contrast_residual, contrast_error)
    comparisons = {channel: paper_comparison(source, channel, channels) for channel in ("b", "c")}
    reference_omegas = [row["photon"] / row["order"]
                        for comparison in comparisons.values() for row in comparison["reference"]]
    reference_omega = reference_omegas[0]
    require(max(abs(value - reference_omega) for value in reference_omegas) < 1e-14,
            "Inconsistent external reference IR frequency")
    source.add(source.root / REVIEW / "REPORT.txt")
    source.add(source.root / "emol/DEFERRED.md")
    source.add(source.root / "emol/docs/CommunicationsPhysics_2026.pdf")
    source.add(source.root / CAMPAIGN / "analysis/fig3_reader/plot_fig3_progress.py")
    calibration = json.loads(source.text(source.root / CAMPAIGN / "wf1/raster_b/calibration.json"))
    validation = {
        "passed": True, "reader_checks": reader_checks, "raw_sidebands_checked": 16,
        "raw_amplitude_files_checked": 144, "relative_points": 10,
        "maximum_saved_delay_residual_as": delay_residual,
        "maximum_saved_contrast_residual": contrast_residual,
        "saved_reading_tolerance": 5.01e-5,
        "description": "The validated reader passes V1–V4. All 16 production sidebands reproduce the saved four-decimal readings from the nine raw amplitude files; all 10 relative-delay points use a common expansion-origin convention.",
    }
    return {
        "meta": {
            "title": "Capturing attosecond delays in electronic and vibrational dependent photoemission of NO molecules",
            "authors": "Wang et al.", "journal": "Communications Physics", "year": 2026,
            "doi": "10.1038/s42005-026-02911-1", "figure": "3", "omega_ev": OMEGA_EV,
            "reference_omega_ev": reference_omega, "origin": "expansion",
            "snapshot": max(row["completed_at"][:10] for rows in channels.values() for row in rows),
            "snapshot_description": "Latest centre-run completion date in the exported campaign",
            "bond_length_angstrom": 1.15,
            "comparison_scope": "Fig. 3 electronic-state delays at fixed nuclei; vibrationally resolved Fig. 5 is not included.",
            "paper_axes": {channel: {axis: calibration["fig3" + panel][axis]["frame_values"]
                                     for axis in ("x", "y")}
                           for channel, panel in (("b", "a"), ("c", "b"))},
            "description": "A reproduction study of relative NO RABBITT delays: eMOL, the paper's digitized measurements and theory, and an independent ePolyScat calculation. The published Fig. 3 theory is not fully reproduced.",
            "geometry": "Random molecular orientation; parallel XUV and IR fields; electrons detected along the polarization; 800 nm.",
            "validation": validation,
        },
        "channels": channels, "comparisons": comparisons,
        "methodnotes": [
            "This is the paper's Fig. 3 electronic-state comparison at fixed nuclei, R(NO) = 1.15 Å. It does not represent the vibrationally resolved comparison in Fig. 5.",
            "Full x,y,z XUV components with detection along the polarization define the complete physical comparison. The page opens with the y-omitted diagnostic selected.",
            "Omitting the XUV y component is a diagnostic selection, not a correction to the physical random-orientation response.",
            "The 4π reading collects every electron direction. It is a different detection geometry; no matching paper or independent-reference overlay is supplied for it.",
            "Experimental error bars and theory curves were digitized from Fig. 3, not supplied as author numerical data. The bars represent propagated 1σ fitted-phase uncertainties; small digitized upper/lower differences are preserved. Bridged theory segments reconstruct stretches obscured by markers. Experimental horizontal coordinates are preserved.",
            "eMOL uses complete second-order amplitudes. The independent ePolyScat reference combines its molecular delay with an asymptotic continuum–continuum term; no extra cc term is added to eMOL.",
            "Every channel difference uses expansion-origin readings. X production uses the ion constraint set and does not permit a hole-centroid shift; its separate Xh acceptance run is excluded.",
            "Hollow eMOL points identify b SB28 and c SB22, whose centre runs lie near K-matrix poles. The box-route replacements pass the overlap-identity checks; the pole flag remains visible. c SB24 also uses the box route but is not pole flagged.",
            "The independent reference preserves its original, slightly more precise photon energies. No fitted phase, scale or horizontal shift is applied.",
            "The original Molpro 2015.1 inputs and orbitals are unavailable. The independent reference uses explicit ROHF orbitals cross-checked between PySCF and Psi4. Agreement between calculations does not establish an author error.",
        ],
        "provenance": {
            "source_root_description": "mpi_static_exchangeHF research checkout; all manifest paths are relative to that root",
            "campaign": str(CAMPAIGN / "emol_data/cp26fig3"), "independent_reference": str(REVIEW),
            "digitization": str(CAMPAIGN / "wf1/raster_b"), "constraint_set": "ion",
            "pole_eigenphase_threshold_rad": POLE_DISTANCE,
            "hash_algorithm": "SHA-256", "hashfile": source.manifest(),
        },
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", required=True, type=Path)
    parser.add_argument("--output", type=Path,
                        default=Path(__file__).resolve().parents[1] / "assets/viz/no-paper-data.js")
    args = parser.parse_args()
    data = export(args.source_root.expanduser().resolve())
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    require(str(args.source_root.expanduser().resolve()) not in payload, "Private source root leaked into payload")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text("// Generated by scripts/export_no_paper.py; do not edit numerical data by hand.\n"
                           "window.NO_PAPER_DATA = " + payload + ";\n")
    validation = data["meta"]["validation"]
    print("Exported 10 relative points, 16 channels/sidebands and %d hashed source files (%d bytes)." %
          (len(data["provenance"]["hashfile"]), args.output.stat().st_size))
    print("Largest saved-reading residual: %.3g as; contrast %.3g." %
          (validation["maximum_saved_delay_residual_as"], validation["maximum_saved_contrast_residual"]))


if __name__ == "__main__":
    main()
