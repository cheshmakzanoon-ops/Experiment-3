# Compact evidence verification

All retained files are byte-identical to the frozen full collection. The full
698,245-byte menu artifact remains. Complete decoded logs are retained as gzip;
redundant plaintext logs, transport wrappers, intermediate polls, a normalized
duplicate commit receipt, and the unused trace-analysis utility are omitted.
Every original file, retained or omitted, has its size/hash and disposition in
`packaging-provenance.json`. `ORIGINAL-SHA256SUMS` identifies the untouched full
collection; use the normal `SHA256SUMS` to verify this compact copy.

```bash
sha256sum -c SHA256SUMS
python -B verify_evidence.py
```

The verifier checks saved records only. To recreate the extraction from the
included full artifact, use `extract-menu-report.py` as shown in README.md. To
repeat compact packaging from the frozen full collection into a new directory:

```bash
python -B package_evidence.py --original /path/to/ci-prewarm-menu-a02e516 --out /path/to/new-compact-evidence
```

No browser, test, simulation, download, or source modification is performed by
either verification or packaging. The original full collection was checked before
and after copying and remains unchanged.
