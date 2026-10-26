#!/usr/bin/env python3
"""Check NO browser data against physical identities and independent reference vectors.

Uses only the Python standard library. With --source-root, additionally verify
every recorded source hash and exact digitized CSV fields. Without that option,
the checks are portable with the website checkout and do not need HDF5 files.
"""

import argparse
import cmath
import csv
from datetime import date
import hashlib
import json
import math
from pathlib import Path, PurePosixPath
import re


AS = 24.188843265857
EV = 27.211386245988
COMPONENTS = ("p1", "m1", "0")
# Published Fig. 3 samples stay fixed when calculated interleaved energies grow.
PAPER_ORDERS = {"b": {18, 20, 22, 24, 26, 28}, "c": {22, 24, 26, 28}}
BASELINE_ORDERS = {**PAPER_ORDERS, "X": PAPER_ORDERS["b"]}


def check(condition, message):
    if not condition:
        raise AssertionError(message)


def close(actual, expected, message, atol=1e-10, rtol=1e-9):
    check(math.isfinite(actual) and math.isfinite(expected) and
          abs(actual - expected) <= atol + rtol * abs(expected), message)


def load_data(path, name):
    text = path.read_text()
    match = re.search(r"window\." + re.escape(name) + r"\s*=\s*(.*);\s*$", text, re.DOTALL)
    check(match is not None, "Missing JSON assignment in " + str(path))
    data = json.loads(match.group(1), parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)))
    check("/Users/" not in match.group(1) and "file://" not in match.group(1), "Private path in browser data")
    def finite(value):
        if isinstance(value, float):
            check(math.isfinite(value), "Nonfinite JSON number")
        elif isinstance(value, list):
            for child in value:
                finite(child)
        elif isinstance(value, dict):
            for child in value.values():
                finite(child)
    finite(data)
    return data


def manifest(entries, source_root):
    result = {}
    for entry in entries:
        path = PurePosixPath(entry["path"])
        check(not path.is_absolute() and ".." not in path.parts, "Non-relative provenance path")
        check(str(path) not in result, "Duplicate provenance path")
        check(re.fullmatch(r"[0-9a-f]{64}", entry["sha256"]) is not None, "Invalid SHA-256")
        if source_root:
            actual = hashlib.sha256((source_root / path).read_bytes()).hexdigest()
            check(actual == entry["sha256"], "Source changed since export: " + str(path))
        result[str(path)] = entry["sha256"]
    return result


def amplitude_files(directory):
    return [str(PurePosixPath(directory) / ("M_q%s%s.h5" % (q, "" if q == s else "_s" + s)))
            for q in COMPONENTS for s in COMPONENTS]


def successful_run(directory):
    done = directory / "RUN_DONE"
    if not done.is_file() or not (directory / "run.log").is_file():
        return False
    result = re.search(r"\brc\s+(-?\d+)\b", done.read_text())
    if result:
        check(int(result[1]) == 0, "Failed production run may not be treated as an incomplete transfer: " + str(directory))
    return result is not None


def source_sidebands(source_root, campaign, channel, angular=False):
    """Independent filesystem coverage audit, without importing an exporter.

    Files still being produced do not count as exportable samples. Existing
    ready products do, even when no measured or independent-reference point
    exists at the same energy. This catches a stale export after new transfers.
    """
    ready, candidates = set(), set()
    trees = [channel] + ([channel + "OFF"] if channel in ("b", "c") else [])
    for tree in trees:
        base = source_root / campaign / tree
        sidebands = base / "sidebands"
        saved = set()
        for path in sidebands.glob("fig3_read_*.out"):
            saved.update(re.findall(r"(Ef[0-9.]+) expansion\s+E_f", path.read_text()))
        for directory in sidebands.glob("Ef*"):
            if not directory.is_dir():
                continue
            relative = directory.relative_to(source_root).as_posix()
            candidates.add(relative)
            center = base / ("E%.6g" % float(directory.name[2:]))
            identity_path = directory / "identity_tool.log"
            if not successful_run(center) or not identity_path.is_file():
                continue
            gates = re.search(r"(\d+) gates, (\d+) failed", identity_path.read_text())
            if not gates:
                continue
            check(int(gates[1]) > 0 and int(gates[2]) == 0,
                  "Failed identity gates may not be treated as an incomplete transfer: " + str(directory))
            if not all((source_root / path).is_file() for path in amplitude_files(relative)):
                continue
            if angular:
                if not all((directory / ("lab_expansion_%d.h5" % angle)).is_file() for angle in (0, 90)):
                    continue
                if not all(any((directory / ("direction_%s_expansion.%s" % (direction, suffix))).is_file()
                               for suffix in ("h5", "log")) for direction in ("Oend", "Nend", "perp")):
                    continue
            elif directory.name not in saved:
                continue
            ready.add(relative)
    return ready, candidates


def check_exclusions(entries, exported, candidates, source_prefix=""):
    paths = [str(PurePosixPath(source_prefix) / row["source"]) for row in entries]
    check(all(isinstance(row["reason"], str) and row["reason"].strip() for row in entries),
          "Incomplete product has no reason")
    check(not (set(paths) & exported), "An excluded product was also exported")
    # Amplitude metadata also records partial one-photon runs; only require
    # sideband exclusions to close against the independently discovered set.
    sideband_paths = [path for path in paths if "/sidebands/Ef" in path]
    check(len(sideband_paths) == len(set(sideband_paths)), "Duplicate incomplete-sideband record")
    check(set(sideband_paths) == candidates - exported, "Unreported or stale sideband exclusion")


def check_paper(paper, source_root):
    check(set(paper["channels"]) == {"b", "c", "X"}, "Unexpected ionic channels")
    check(paper["meta"]["origin"] == "expansion" and paper["provenance"]["constraint_set"] == "ion",
          "Relative comparison changed its origin or constraint set")
    hashes = manifest(paper["provenance"]["hashfile"], source_root)
    threshold = paper["provenance"]["pole_eigenphase_threshold_rad"]
    by_channel = {}
    raw_count = 0
    pole_points = set()
    for channel, rows in paper["channels"].items():
        orders = [row["order"] for row in rows]
        check(orders == sorted(set(orders)), "Repeated or unsorted sideband")
        check(BASELINE_ORDERS[channel] <= set(orders), "An original production sample was lost")
        by_channel[channel] = {row["order"]: row for row in rows}
        for row in rows:
            close(row["photon"], row["order"] * paper["meta"]["omega_ev"], "Sideband energy inconsistency")
            check(row["constraint_set"] == "ion" and "/Xh/" not in row["source"], "Diagnostic hole set in production")
            check(row["is_paper_sideband"] is (row["order"] % 2 == 0),
                  "Interleaved calculated energy was labelled as a paper sideband")
            check(row["at_pole"] == (row["pole_distance"] < threshold), "Incorrect centre-run pole flag")
            check(0 <= row["contrast"] <= 1 and 0 <= row["omitted_contrast"] <= 1, "Invalid visibility")
            check(row["reader_output"] in hashes, "Unhashed saved reading")
            check(all(path in hashes for path in amplitude_files(row["source"])), "Missing raw amplitude provenance")
            check(str(PurePosixPath(row["source"]) / "identity_tool.log") in hashes, "Missing identity provenance")
            centre = PurePosixPath(row["source"]).parent.parent / ("E%.6g" % row["ef"])
            check(str(centre / "RUN_DONE") in hashes and str(centre / "run.log") in hashes, "Missing centre provenance")
            raw_count += 1
        if source_root:
            ready, candidates = source_sidebands(source_root, paper["provenance"]["campaign"], channel)
            exported = {row["source"] for row in rows}
            check(exported == ready, "Paper export does not cover the ready " + channel + " energy samples")
            exclusions = [row for row in paper["meta"]["excluded_sidebands"] if row["channel"] == channel]
            check_exclusions(exclusions, exported, candidates)

    relative_count = 0
    for channel, comparison in paper["comparisons"].items():
        rows = comparison["emol"]
        common_orders = sorted(set(by_channel[channel]) & set(by_channel["X"]))
        check([row["order"] for row in rows] == common_orders, "Relative curve lost or added a sideband")
        for row in rows:
            a, x = by_channel[channel][row["order"]], by_channel["X"][row["order"]]
            close(a["photon"], x["photon"], "Compared channels at different photon energies")
            for quantity in ("complete", "omitted", "fourpi"):
                close(row[quantity], a[quantity] - x[quantity], "Incorrect relative delay", atol=1e-12)
            check(row["at_pole"] == (a["at_pole"] or x["at_pole"]), "Relative curve lost a pole flag")
            check(row["is_paper_sideband"] is a["is_paper_sideband"] is x["is_paper_sideband"],
                  "Relative curve changed the interleaved-energy classification")
            if row["at_pole"]:
                pole_points.add((channel, row["order"]))
            relative_count += 1
        for name in ("measured", "reference"):
            orders = [row["order"] for row in comparison[name]]
            check(len(orders) == len(set(orders)) and set(orders) == PAPER_ORDERS[channel],
                  "The published " + name + " grid was extended or lost samples")
            check(set(orders) <= set(common_orders), "The paper comparison lost a calculated reference energy")
        for row in comparison["measured"]:
            check(row["err_up"] > 0 and row["err_down"] > 0, "Invalid experimental uncertainty")
        check(any(row["err_up"] != row["err_down"] for row in comparison["measured"]), "Digitized error bars were symmetrized")
        check(any(abs(row["photon"] - row["order"] * paper["meta"]["omega_ev"]) > 1e-3
                  for row in comparison["measured"]), "Digitized measured coordinates were snapped to harmonics")
        theory = comparison["theory"]
        check({row["flag"] for row in theory} == {"local", "bridged"}, "Theory reconstruction flags lost")
        check(all(row["kinds"] for row in theory), "Missing digitization trace provenance")
        check(all(a["photon"] < b["photon"] for a, b in zip(theory, theory[1:])), "Theory energy grid not ordered")
        for row in comparison["reference"]:
            close(row["photon"], row["order"] * paper["meta"]["reference_omega_ev"], "Reference energy shifted")
            close(row["complete"], row["molecular"] + row["cc"], "Reference delay split failed")
            close(row["omitted"], row["molecular_omitted"] + row["cc_omitted"], "Reference diagnostic split failed")
        if source_root:
            panel = "a" if channel == "b" else "b"
            raster = source_root / paper["provenance"]["digitization"]
            with (raster / ("fig3%s_measured_points.csv" % panel)).open() as handle:
                original = {int(r["sideband"][2:]): r for r in csv.DictReader(handle)}
            for row in comparison["measured"]:
                for key, field in (("photon", "photon_energy_eV"), ("value", "relative_delay_as"),
                                   ("err_up", "err_up_as"), ("err_down", "err_down_as")):
                    check(row[key] == float(original[row["order"]][field]), "Digitized measurement was altered")
            with (raster / ("fig3%s_theory_line_resampled_0p1eV.csv" % panel)).open() as handle:
                original_theory = list(csv.DictReader(handle))
            check(len(original_theory) == len(theory), "Theory digitization lost samples")
            for row, original in zip(theory, original_theory):
                check(row["photon"] == float(original["photon_energy_eV"]) and
                      row["value"] == float(original["relative_delay_as"]) and
                      row["flag"] == original["flag"] and row["kinds"] == original["kinds_in_window"],
                      "Theory digitization or bridge flags were altered")
    check({("b", 28), ("c", 22)} <= pole_points, "Original near-pole warnings were lost")
    validation = paper["meta"]["validation"]
    check(validation["passed"] and validation["reader_checks"] == 15, "Missing validated-reader checks")
    check(validation["raw_sidebands_checked"] == raw_count and
          validation["raw_amplitude_files_checked"] == raw_count * 9 and
          validation["relative_points"] == relative_count, "Validation counts do not cover the data")
    check(validation["maximum_saved_delay_residual_as"] <= validation["saved_reading_tolerance"] and
          validation["maximum_saved_contrast_residual"] <= validation["saved_reading_tolerance"], "Saved reading precision failed")
    latest_center = max(row["completed_at"][:10] for rows in paper["channels"].values() for row in rows)
    check(paper["meta"]["latest_centre_completion"] == latest_center, "Latest centre-run date is incorrect")
    check(date.fromisoformat(paper["meta"]["snapshot"]) >= date.fromisoformat(latest_center) and
          "export date" in paper["meta"]["snapshot_description"],
          "The data snapshot is not identified as a validated export date")
    return hashes


def complex_pair(pair):
    check(isinstance(pair, list) and len(pair) == 2, "Malformed complex pair")
    check(all(isinstance(x, (int, float)) and math.isfinite(x) for x in pair), "Nonfinite amplitude")
    return complex(*pair)


def basis(point):
    check(len(point["l"]) == len(point["m"]) > 0, "Empty or inconsistent angular basis")
    indices = []
    for l, m in zip(point["l"], point["m"]):
        check(isinstance(l, int) and isinstance(m, int) and l >= 0 and abs(m) <= l, "Invalid harmonic index")
        indices.append(l * l + l + m)
    check(indices == sorted(set(indices)), "Duplicated or reordered harmonic channel")
    check(0 <= point["dropped_weight_fraction"] < 1e-20, "Uncontrolled sparse amplitude loss")
    return len(indices)


def tensor(point, key):
    n = len(point["l"])
    check(len(point[key]) == 3 and all(len(row) == 3 for row in point[key]), "Incomplete photon-component tensor")
    check(all(len(row) == n for plane in point[key] for row in plane), "Tensor and harmonic dimensions differ")
    return [[[complex_pair(z) for z in row] for row in plane] for plane in point[key]]


def harmonics(point, theta, phi):
    # Independent standard-library recurrence for orthonormal real harmonics,
    # with the Condon–Shortley sign absent, as specified by the amplitudes.
    z = math.cos(theta)
    values = []
    for l, signed_m in zip(point["l"], point["m"]):
        m = abs(signed_m)
        p = 1.0
        root = math.sqrt(max(0.0, 1.0 - z * z))
        for k in range(1, m + 1):
            p *= (2 * k - 1) * root
        if l > m:
            previous, p = p, (2 * m + 1) * z * p
            for degree in range(m + 2, l + 1):
                previous, p = p, ((2 * degree - 1) * z * p - (degree + m - 1) * previous) / (degree - m)
        norm = math.sqrt((2 * l + 1) / (4 * math.pi) * math.exp(math.lgamma(l - m + 1) - math.lgamma(l + m + 1)))
        azimuth = 1.0 if m == 0 else math.sqrt(2) * (math.cos(m * phi) if signed_m > 0 else math.sin(m * phi))
        values.append(norm * p * azimuth)
    return values


def check_amplitudes(data, paper, paper_hashes, source_root):
    hashes = manifest(data["meta"]["sources"], source_root)
    check(all(hashes[path] == paper_hashes[path] for path in hashes.keys() & paper_hashes.keys()),
          "Shared scientific source changed between the two exports")
    prefix = data["meta"]["source_prefix"]
    check(data["meta"]["dipole_origin"] == paper["meta"]["origin"] == "expansion", "Amplitude and paper origins differ")
    check("preapplied" in data["meta"]["two_photon_phase"], "Missing final partial-wave phase convention")
    check(set(data["channels"]) == set(paper["channels"]), "Amplitude channels differ from paper channels")
    one_count = two_count = 0
    for channel, content in data["channels"].items():
        points = content["onePhoton"]
        check(len(points) >= {"b": 13, "c": 9, "X": 13}[channel], "Original one-photon coverage was lost")
        check(all(a["energy_ev"] < b["energy_ev"] for a, b in zip(points, points[1:])), "Duplicate/unsorted one-photon energy")
        for point in points:
            n = basis(point)
            check(len(point["D"]) == 3 and all(len(row) == n for row in point["D"]), "Incomplete dipole components")
            d = [[complex_pair(z) for z in row] for row in point["D"]]
            for axis, row in zip(("x", "y", "z"), d):
                close(point["prefactor_mb"] * sum(abs(z) ** 2 for z in row), point["sigma_mb"][axis],
                      "One-photon Parseval cross-section identity failed")
            close(sum(point["sigma_mb"][a] for a in ("x", "y", "z")) / 3,
                  point["sigma_mb"]["avg"], "Orientation-averaged cross section failed")
            close(point["photon_ev"] - point["energy_ev"], content["ip_ev"], "One-photon threshold mismatch")
            check(str(PurePosixPath(prefix) / point["source"]) in hashes and not point["source"].startswith("Xh/"),
                  "Missing production dipole provenance")
            check(point["at_pole"] == (point["pole_distance_rad"] < paper["provenance"]["pole_eigenphase_threshold_rad"]),
                  "Incorrect one-photon pole flag")
            one_count += 1
        if source_root:
            # Production main-route samples precede OFF redos at the same
            # named energy; the exporter may not silently ignore ready points.
            selected = {}
            for tree in [channel] + ([channel + "OFF"] if channel in ("b", "c") else []):
                for path in (source_root / prefix / tree).glob("E*/dipole.h5"):
                    if successful_run(path.parent):
                        selected.setdefault(path.parent.name, path.relative_to(source_root).as_posix())
            exported = {str(PurePosixPath(prefix) / point["source"]) for point in points}
            check(exported == set(selected.values()), "Amplitude export lost or added a ready one-photon sample")
        paper_rows = {r["order"]: r for r in paper["channels"][channel]}
        check([r["order"] for r in content["sidebands"]] == sorted(paper_rows), "Amplitude sideband coverage differs")
        for point in content["sidebands"]:
            n = basis(point)
            absorption, emission = tensor(point, "M_abs"), tensor(point, "M_emi")
            row = paper_rows[point["order"]]
            check(point["origin"] == "expansion", "Mixed sideband origin")
            close(point["energy_ev"], row["ef"], "Sideband electron energy mismatch", atol=5.01e-7)
            close(point["photon_ev"], row["photon"], "Sideband photon energy mismatch")
            close(point["omega_hartree"] * EV, paper["meta"]["omega_ev"], "Sideband IR frequency mismatch")
            check(point["at_pole"] == row["at_pole"] and point["route"] == row["route"], "Sideband route or pole differs")
            directory = str(PurePosixPath(prefix) / point["source"])
            check(directory == row["source"], "Paper and explorer use different raw sidebands")
            for path in amplitude_files(directory):
                check(path in hashes and hashes[path] == paper_hashes[path], "Paper and explorer source hashes differ")
            # Isotropic fourth moment <eps_q eps_s eps_t eps_u>. The final
            # partial-wave phase cancels in this all-direction contraction.
            interference = 0j
            for q in range(3):
                for s in range(3):
                    for t in range(3):
                        for u in range(3):
                            weight = ((q == s and t == u) + (q == t and s == u) + (q == u and s == t)) / 15
                            if weight:
                                interference += weight * sum(emission[q][s][k] * absorption[t][u][k].conjugate() for k in range(n))
            delay = cmath.phase(interference) * AS / (2 * point["omega_hartree"])
            close(delay, row["fourpi"], "Sparse amplitudes do not reproduce the paper export's 4π reading", atol=5.01e-5)
            close(delay, point["lab"]["0"]["tau_R_as"], "Tensor contraction differs from stored lab result", atol=1e-7)
            for lab in point["lab"].values():
                close(lab["tau_R_as"], lab["tau_1_as"] + lab["tau_cc_as"], "Lab delay split failed")
                check(0 <= lab["fringe_depth"] <= 1, "Invalid lab contrast")
            two_count += 1
        if source_root:
            ready, candidates = source_sidebands(source_root, prefix, channel, angular=True)
            exported = {str(PurePosixPath(prefix) / row["source"]) for row in content["sidebands"]}
            check(exported == ready, "Amplitude export does not cover ready " + channel + " energy samples")
            exclusions = [row for row in data["meta"]["excluded_incomplete"]
                          if row["source"].split("/", 1)[0] in {channel, channel + "OFF"}]
            check_exclusions(exclusions, exported, candidates, prefix)
    check(two_count == paper["meta"]["validation"]["raw_sidebands_checked"], "Incomplete two-photon amplitude coverage")
    checks = data["meta"]["validation"]["checks"]
    check(checks["dipole_prefactors"] == one_count and checks["lab_interference_delays"] == 2 * two_count,
          "Amplitude validation does not cover every exported energy")
    check(checks["sideband_identity_gates"] == two_count, "Missing overlap-identity checks")
    check(checks["stored_direction_delays"] == checks["stored_direction_strengths"] and
          checks["stored_direction_delays"] + checks["stored_direction_refusals"] == 3 * two_count,
          "Stored directional checks or node refusals are missing")
    return one_count, two_count


def check_vectors(data):
    counts = {}
    for kind in ("onePhoton", "twoPhoton"):
        vectors = data["selftests"][kind]
        covered = set()
        for vector in vectors:
            point = data["channels"][vector["channel"]]["onePhoton" if kind == "onePhoton" else "sidebands"][vector["index"]]
            y, eps = harmonics(point, vector["theta"], vector["phi"]), vector["eps"]
            close(sum(e * e for e in eps), 1.0, "Non-unit polarization test vector")
            covered.add((vector["channel"], vector["index"]))
            if kind == "onePhoton":
                value = sum(eps[q] * complex_pair(point["D"][q][k]) * y[k] for q in range(3) for k in range(len(y)))
                close(abs(value) ** 2 * point["prefactor_mb"], vector["expected"], "Independent one-photon reference failed", atol=1e-10)
            else:
                paths = []
                for key in ("M_abs", "M_emi"):
                    values = [sum(eps[q] * eps[s] * complex_pair(point[key][q][s][k]) for q in range(3) for s in range(3))
                              for k in range(len(y))]
                    terms = [a * h for a, h in zip(values, y)]
                    amplitude = sum(terms)
                    condition = abs(amplitude) / sum(abs(t) for t in terms) if any(terms) else 0
                    mean = sum(abs(a) ** 2 for a in values) / (4 * math.pi)
                    valid = (condition > data["meta"]["node_condition_min"] and
                             abs(amplitude) ** 2 > data["meta"]["node_intensity_relative_min"] * mean)
                    paths.append((amplitude, valid))
                a, e = paths[0][0], paths[1][0]
                expected = vector["expected"]
                valid = paths[0][1] and paths[1][1]
                check(valid == expected["valid"], "Node validity differs from dense reference")
                close((abs(a) ** 2 + abs(e) ** 2) / 2, expected["strength"], "Two-photon strength reference failed", atol=1e-10)
                if valid:
                    phase = cmath.phase(e * a.conjugate())
                    reference_phase = expected["delay_as"] * 2 * point["omega_hartree"] / AS
                    close(cmath.phase(cmath.exp(1j * (phase - reference_phase))), 0,
                          "Two-photon phase reference failed", atol=1e-9)
                    close(2 * abs(a) * abs(e) / (abs(a) ** 2 + abs(e) ** 2), expected["contrast"],
                          "Two-photon contrast reference failed", atol=1e-9)
                else:
                    check(expected["delay_as"] is None, "A node was given a physical delay")
                    check(expected["contrast"] is None, "A node was given a numerical interference contrast")
        expected_count = sum(len(c["onePhoton" if kind == "onePhoton" else "sidebands"]) for c in data["channels"].values())
        check(len(covered) == expected_count, "Reference vectors do not cover every sample")
        counts[kind] = len(vectors)
    return counts


def check_fig4(data, amplitudes, source_root, amplitude_path):
    hashes = manifest(data["provenance"]["hashfile"], source_root)
    check(set(data["channels"]) == {"X", "b", "c", "A"}, "Fig. 4 lost an ionic channel")
    check(data["meta"]["emol_wigner_available_under_common_convention"] is False,
          "Unmatched eMOL Wigner average was marked available")
    check(data["meta"]["validation"]["amplitude_export_sha256"] == hashlib.sha256(amplitude_path.read_bytes()).hexdigest(),
          "Fig. 4 used a different amplitude export")
    computed = 0
    for channel, content in data["channels"].items():
        for quantity in ("sigma", "delay"):
            rows = content["paper"][quantity]
            check(all(a["photon"] < b["photon"] for a, b in zip(rows, rows[1:])), "Fig. 4 paper curve is not ordered")
            check(all(r["flag"] in {"local", "bridged"} for r in rows), "Fig. 4 digitization flags lost")
            if source_root:
                state = {"X": "X1Sigma+", "b": "b3Pi", "A": "A1Pi", "c": "c3Pi"}[channel]
                panel, field = ("a", "cross_section_Mb_per_sr") if quantity == "sigma" else ("b", "wigner_delay_as")
                path = source_root / data["provenance"]["paper_digitization"] / ("fig4%s_%s_resampled_0p1eV.csv" % (panel, state))
                with path.open() as handle:
                    original = list(csv.DictReader(handle))
                check(len(original) == len(rows), "Fig. 4 digitized curve gained or lost samples")
                for row, raw in zip(rows, original):
                    check(row["photon"] == float(raw["photon_energy_eV"]) and row["value"] == float(raw[field]) and
                          row["flag"] == raw["flag"] and row["kinds"] == raw["kinds_in_window"],
                          "Fig. 4 paper values, coordinates or reconstruction flags changed")
        for convention in ("complete", "omitted"):
            for family in ("reference", "fine", "emol"):
                for row in content[family][convention]:
                    close(row["sigma"], 4 * math.pi * row["directional_sigma"], "Fig. 4 scale is not explicit 4π")
                    check(row["directional_sigma"] >= 0, "Negative cross section")
                    if family == "emol":
                        check("tau" not in row, "Unmatched eMOL Wigner data appeared")
                        check(row["source"] in hashes, "Unhashed Fig. 4 raw dipole")
                    elif family == "reference":
                        close(row["photon"] - row["energy"], content["ip_ev"], "Reference threshold mismatch")
                    else:
                        check(row["stencil_halfwidth_ev"] > 0, "Missing fine derivative stencil")
            if source_root:
                base = source_root / data["provenance"]["reference"]
                suffix = "fresh" if convention == "complete" else "xz_diagnostic"
                with (base / ("fig4_%s_%s.csv" % (channel, suffix))).open() as handle:
                    original = list(csv.DictReader(handle))
                check(len(original) == len(content["reference"][convention]), "Reference curve coverage changed")
                for row, raw in zip(content["reference"][convention], original):
                    for key, field in (("photon", "photon_ev"), ("energy", "energy_ev"),
                                       ("directional_sigma", "sigma_LF0_Mb_sr"), ("tau", "tau_LF0_as")):
                        check(row[key] == float(raw[field]), "Fig. 4 broad reference value changed")
                with (base / "fine_checkpoints.csv").open() as handle:
                    subset = "xyz" if convention == "complete" else "xz"
                    original_fine = sorted((r for r in csv.DictReader(handle) if r["state"] == channel and r["subset"] == subset),
                                           key=lambda r: float(r["photon_eV"]))
                check(len(original_fine) == len(content["fine"][convention]), "Fine checkpoint coverage changed")
                for row, raw in zip(content["fine"][convention], original_fine):
                    for key, field in (("photon", "photon_eV"), ("directional_sigma", "sigma_LF_Mb_sr"),
                                       ("sigma", "sigma_LF_times4pi_diagnostic"), ("tau", "tau_complex_as"),
                                       ("tau_phase", "tau_phase_as"), ("stencil_halfwidth_ev", "stencil_halfwidth_eV")):
                        check(row[key] == float(raw[field]), "Fig. 4 fine checkpoint value changed")
                    check(row["source_dataset"] == raw["source_dataset"], "Fine derivative provenance changed")
            if channel == "A":
                check(content["emol"][convention] == [], "Unavailable A-channel eMOL amplitudes were filled")
                continue
            source_points = amplitudes["channels"][channel]["onePhoton"]
            rows = content["emol"][convention]
            check(len(rows) == len(source_points), "Fig. 4 eMOL energy coverage changed")
            for row, point in zip(rows, source_points):
                close(row["photon"], point["photon_ev"], "Fig. 4 eMOL energy shifted")
                close(row["energy"], point["energy_ev"], "Fig. 4 kinetic energy shifted")
                check(row["route"] == point["route"] and row["at_pole"] == point["at_pole"], "Fig. 4 route/pole provenance changed")
                check(row["source"] == str(PurePosixPath(amplitudes["meta"]["source_prefix"]) / point["source"]),
                      "Fig. 4 used a different raw dipole")
                if convention == "complete":
                    expected = point["sigma_mb"]["avg"] * (1 + point["beta"]) / (4 * math.pi)
                    close(row["directional_sigma"], expected, "Fig. 4 directional cross section does not close")
                    computed += 1
    check(computed == data["meta"]["validation"]["raw_dipoles_checked"] ==
          sum(len(channel["onePhoton"]) for channel in amplitudes["channels"].values()),
          "Incomplete Fig. 4 validation")
    a_delay = data["channels"]["A"]["paper"]["delay"]
    check(a_delay[-1]["photon"] < 40 and any(b["photon"] - a["photon"] > .15 for a, b in zip(a_delay, a_delay[1:])),
          "Unresolved A-delay digitization intervals were filled")


def main():
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", type=Path)
    parser.add_argument("--paper", type=Path, default=root / "assets/viz/no-paper-data.js")
    parser.add_argument("--amplitudes", type=Path, default=root / "assets/viz/no-amplitude-data.js")
    parser.add_argument("--fig4", type=Path, default=root / "assets/viz/no-fig4-data.js")
    parser.add_argument("--paper-only", action="store_true")
    args = parser.parse_args()
    paper = load_data(args.paper, "NO_PAPER_DATA")
    hashes = check_paper(paper, args.source_root)
    relative_count = sum(len(comparison["emol"]) for comparison in paper["comparisons"].values())
    print("PASS: %d relative delays; paper grids, interleaved energies, origins, pole flags and source contracts" % relative_count)
    if not args.paper_only:
        amplitudes = load_data(args.amplitudes, "NO_AMPLITUDE_DATA")
        one, two = check_amplitudes(amplitudes, paper, hashes, args.source_root)
        vectors = check_vectors(amplitudes)
        print("PASS: %d dipoles and %d two-photon energy samples; Parseval, lab tensor average and common-source identities" % (one, two))
        print("PASS: independent real-harmonic reconstruction of %d one-photon and %d two-photon dense reference vectors" %
              (vectors["onePhoton"], vectors["twoPhoton"]))
        fig4 = load_data(args.fig4, "NO_FIG4_DATA")
        check_fig4(fig4, amplitudes, args.source_root, args.amplitudes)
        print("PASS: Fig. 4 four-state references, explicit 4π normalization, %d eMOL cross sections and no unmatched Wigner substitution" % one)
    if args.source_root:
        print("PASS: every source SHA-256 and original digitized CSV field checked against the research checkout")


if __name__ == "__main__":
    main()
