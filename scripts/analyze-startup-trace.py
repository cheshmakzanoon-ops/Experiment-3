#!/usr/bin/env python3
"""Summarize native startup timing already recorded in a Playwright trace.

Reads either an extracted .trace file or a trace.zip. Does not launch a browser,
change clocks, or infer GPU completion from a timeout. No extra dependencies.
"""

import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path
import zipfile


PREFIX = "__APEX_MENU_TIMING__"
TIMEOUT_EXPIRED = 37147
SIGNALED = {37146, 37148}


def strings(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, list):
        for item in value:
            yield from strings(item)
    elif isinstance(value, dict):
        for item in value.values():
            yield from strings(item)


def summarize(raw):
    documents = {}
    prepare_clicks = {}
    fragments = {}
    other_console = Counter()
    rows = [json.loads(line) for line in raw.splitlines() if line.strip()]
    for row in rows:
        text = row.get("text", "")
        if row.get("type") == "console" and text.startswith(PREFIX):
            packet = json.loads(text[len(PREFIX):])
            origin = packet["origin"]
            document = documents.setdefault(origin, {"packets": [], "events": [], "dropped": 0})
            document["packets"].append(packet["sequence"])
            document["dropped"] = max(document["dropped"], packet["dropped"])
            document["events"].extend(packet["events"])
        elif row.get("type") == "console":
            other_console[row.get("messageType", "unknown")] += 1
        if row.get("type") == "before" and row.get("method") == "click":
            if "PREPARE GRID START PAUSED" in row.get("params", {}).get("selector", ""):
                prepare_clicks[row["callId"]] = {"startTraceMs": row["startTime"]}
        if row.get("type") == "after" and row.get("callId") in prepare_clicks:
            prepare_clicks[row["callId"]]["endTraceMs"] = row["endTime"]
        if row.get("type") == "frame-snapshot":
            snapshot = row["snapshot"]
            for value in strings(snapshot.get("html", [])):
                if value.startswith(("Loading ", "Preparing ", "Compiling ", "Warming ",
                                     "Waiting ", "Capturing ", "Finishing ")):
                    if value != "Loading progress" and not value.endswith("%"):
                        fragments.setdefault(value, snapshot["timestamp"])

    summaries = []
    for origin, document in documents.items():
        events = document["events"]
        fences = defaultdict(list)
        for event in events:
            if event.get("fence") is not None:
                fences[(event["context"], event["fence"])].append(event)
        fence_summaries = []
        for (context, fence), history in fences.items():
            created = next((e["at"] for e in history if e["kind"] == "fence-end"), None)
            waits = [e for e in history if e["kind"] == "wait-end"]
            deleted = [e["at"] for e in history if e["kind"] == "fence-delete"]
            signaled = [e["at"] for e in waits if e["result"] in SIGNALED]
            fence_summaries.append({
                "context": context,
                "fence": fence,
                "createdPageMs": created,
                "lastObservedPageMs": history[-1]["at"],
                "observedAgeMs": history[-1]["at"] - created if created is not None else None,
                "waits": len(waits),
                "waitResults": dict(Counter(e["result"] for e in waits)),
                "firstSignaledPageMs": signaled[0] if signaled else None,
                "deletedPageMs": deleted[-1] if deleted else None,
            })
        # Keep the report compact while retaining both expensive and terminal work.
        selected = sorted(fence_summaries, key=lambda e: e["observedAgeMs"] or 0, reverse=True)[:5]
        selected += fence_summaries[-5:]
        selected = list({(e["context"], e["fence"]): e for e in selected}.values())
        selected.sort(key=lambda e: (e["context"], e["fence"]))
        heartbeats = [e for e in events if e["kind"] == "timer"]
        summaries.append({
            "performanceTimeOrigin": origin,
            "packetCount": len(document["packets"]),
            "packetSequencesUnique": len(set(document["packets"])) == len(document["packets"]),
            "browserDroppedEvents": document["dropped"],
            "eventCounts": dict(Counter(e["kind"] for e in events)),
            "contexts": [e for e in events if e["kind"] == "context"],
            "contextLoss": [e for e in events if e["kind"] == "context-lost"],
            "longestTasks": sorted((e for e in events if e["kind"] == "long-task"),
                                   key=lambda e: e["duration"], reverse=True)[:5],
            "fenceCount": len(fence_summaries),
            "selectedFences": selected,
            "unreleasedFences": [e["fence"] for e in fence_summaries if e["deletedPageMs"] is None],
            "lastHeartbeat": heartbeats[-1] if heartbeats else None,
        })
    return {
        "boundary": "Read-only trace summary. Page times are relative to each document's own origin; trace times use Playwright's clock. Observed wait age is not proof of eventual completion or a deadlock.",
        "waitResults": {"ALREADY_SIGNALED": 37146, "TIMEOUT_EXPIRED": TIMEOUT_EXPIRED,
                        "CONDITION_SATISFIED": 37148, "WAIT_FAILED": 37149},
        "otherConsoleCounts": dict(other_console),
        "prepareClicks": list(prepare_clicks.values()),
        "firstObservedSnapshotFragments": fragments,
        "documents": summaries,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("trace", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    source = args.trace.read_bytes()
    if zipfile.is_zipfile(args.trace):
        with zipfile.ZipFile(args.trace) as archive:
            raw = archive.read("0-trace.trace").decode("utf-8")
    else:
        raw = source.decode("utf-8")
    result = summarize(raw)
    result["source"] = {"name": args.trace.name, "sha256": hashlib.sha256(source).hexdigest(),
                        "bytes": len(source)}
    encoded = json.dumps(result, indent=2) + "\n"
    if args.output:
        args.output.write_text(encoded)
    else:
        print(encoded, end="")


if __name__ == "__main__":
    main()
