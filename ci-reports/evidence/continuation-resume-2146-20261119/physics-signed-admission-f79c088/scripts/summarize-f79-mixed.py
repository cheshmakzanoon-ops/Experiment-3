"""Summarize existing records only; never simulate or change a source input."""
import hashlib
import json
from pathlib import Path
import sys

new_path, base_path, old_path, summary_path, compact_path = map(Path, sys.argv[1:])
paths = {"7ac509f": base_path, "3e58984": old_path, "f79c088": new_path}
data = {name: json.loads(path.read_bytes()) for name, path in paths.items()}
pins = {
    name: {"path": str(path), "bytes": path.stat().st_size,
           "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
    for name, path in paths.items()
}


def window(record, start, end):
    rows = [b for b in record["bins"]
            if b["id"] == 2 and b["lap"] == 1 and start <= b["stationStart"] < end]
    count = sum(b["trajectorySamples"] for b in rows)
    return {
        "rider": 2, "completedLapsAtObservation": 1,
        "stationFrom": start, "stationToExclusive": end,
        "timeSeconds": sum(b["timeSeconds"] for b in rows),
        "trajectorySamples": count,
        "means": {key: sum(b[key + "Sum"] for b in rows) / count
                  for key in ["speed", "target", "free", "traffic", "plan"]},
        **{key: sum(b[key] for b in rows)
           for key in ["trafficLimited", "planLimited", "braking", "throttleBelowHalf",
                       "tractionCut", "trialSamples", "trialPedalChanged"]},
        "yellowSamples": sum(b["trafficReasons"].get("yellow", 0) for b in rows),
    }


record = data["f79c088"]
fixture_pairs = {
    (x["fixture"]["reserve"]["current"]["liveBeforeSha256"],
     x["fixture"]["reserve"]["current"]["liveAfterSha256"])
    for x in record["fixtures"] if x["fixture"]["reserve"]["current"]
}
assert all(a == b for a, b in fixture_pairs)
additional = record["marshalTransitions"] + record["gp2Timeline"]
assert all(x["liveBeforeSha256"] == x["liveAfterSha256"] for x in additional)
assert len(additional) == record["additionalObservationCount"]
assert all(x["originalNativePlantInputExact"] and x["allocationBoundaryExact"]
           for x in record["trialRecords"])
assert len(record["trialRecords"]) == record["originalAllocationReplaysExact"]
assert record["gpBest"] == record["originalRun"]["expectedFastestValidGP"]
assert record["sbkBest"] == record["originalRun"]["expectedFastestValidSuperbike"]

windows = {f"{start}-{end}": {name: window(d, start, end) for name, d in data.items()}
           for start, end in [(1750, 2300), (1850, 2150), (1950, 2150),
                              (1500, 1650), (2750, 3000), (3500, 3750)]}
classes = {}
for name, d in data.items():
    gp = min((x for x in d["final"] if x["id"] in [0, 2, 4]), key=lambda x: x["best"] or float("inf"))
    sbk = min((x for x in d["final"] if x["id"] in [1, 3, 5]), key=lambda x: x["best"] or float("inf"))
    classes[name] = {"fastestValidGP": {"id": gp["id"], "seconds": gp["best"]},
                     "fastestValidSuperbike": {"id": sbk["id"], "seconds": sbk["best"]},
                     "superbikeMinusGP": d["margin"], "crashes": d["crashes"],
                     "rider2NativeSecondLapRecord": next((x for x in d["laps"] if x["id"] == 2 and x["completed"] == 2), None)}

summary = {
    "status": "f79 is rejected: original fastest-valid GP lap remains slower; no new source proposal.",
    "scriptSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    "sources": pins, "classResults": classes, "rider2SecondLapWindows": windows,
    "candidateEvidence": {
        "originalRun": record["originalRun"],
        "nativeFallCalls": record["nativeFallCalls"], "crashes": record["crashes"],
        "localYellowEvents": [e for row in record["marshalTransitions"] for e in row["events"] if "YELLOW" in e.get("code", "")],
        "marshalRows": len(record["marshalTransitions"]),
        "gp2WindowRows": len(record["gp2Timeline"]),
        "gp2WindowAllFlagsZero": all(not any(row["flags"]) for row in record["gp2Timeline"]),
        "runtimeHistoryQueryCount": record["observations"],
        "distinctRetainedHistoryQueryHashPairs": len(fixture_pairs),
        "retainedAdditionalBikeAndGPHashPairs": len(additional),
        "exactAllocationReplays": record["originalAllocationReplaysExact"],
        "retainedLapEvents": len(record["laps"]),
        "finalCompletedLaps": [x["completed"] for x in record["final"]],
        "nativeBestLapRecords": [x for x in record["laps"] if x["id"] in [1, 2] and x["completed"] == 2],
    },
    "limits": [
        "Lap values are fastest valid class laps, not finish times. The original test stops at the faster-GP assertion; its subsequent 0.15-second margin assertion is not reached.",
        "The runtime checks cover 37300 history observations, but only 15 distinct selected fixture hash pairs are retained. The 1053 additional pairs cover enumerable Bike/GP fields of all cars, not every Simulation, AI or marshal field.",
        "Fall/flag observations run before the inherited non-RACING continue and include the terminal step. The inherited lap/bin sampler skips that terminal phase, retaining 11 lap events while final classification confirms all six riders completed two laps. No missing final SBK5 chequered event is invented.",
        "The 7ac winning GP2 terminal lap event/sectors are not retained. Its final valid best is retained; missing sectors are not inferred.",
        "Station residence is a 120Hz sampled trajectory measure. Native sectors are separate lap-timer measurements. Different field separation and traffic exposure preclude treating their differences as an isolated tyre/reserve/command slowdown.",
        "Zero falls and absence of the old caution chain are observed on this exact bounded run. They do not establish all-venue stability, justify the remaining pace loss, or accept the candidate."
    ]
}
summary_path.write_text(json.dumps(summary, indent=2) + "\n")
compact = {
    "scope": "Lossless selected source rows needed to recompute class/GP2-window comparisons; full source recording digests are pinned.",
    "sources": pins,
    "records": {
        name: {"gpBest": d["gpBest"], "sbkBest": d["sbkBest"], "margin": d["margin"],
               "crashes": d["crashes"], "final": d["final"], "laps": d["laps"],
               "bins": [b for b in d["bins"] if b["id"] == 2 and b["lap"] == 1]}
        for name, d in data.items()
    }
}
compact_path.write_text(json.dumps(compact, separators=(",", ":")) + "\n")
print(json.dumps({"classes": classes, "candidateEvidence": summary["candidateEvidence"],
                  "summarySha256": hashlib.sha256(summary_path.read_bytes()).hexdigest(),
                  "compactSha256": hashlib.sha256(compact_path.read_bytes()).hexdigest()}, indent=2))
