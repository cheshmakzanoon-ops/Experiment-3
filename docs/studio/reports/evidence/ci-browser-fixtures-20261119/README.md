# Browser fixture follow-up evidence

This evidence describes CI run **44516038410** on source **2d67572a9a2ba4daa33311dcc9abed2c1b537632**, and the separately identified local fixture corrections. The corrected browser tests remain **unexecuted**; the broader graphics failures remain unresolved. Nothing here is a High, full-browser, or physics acceptance receipt.

- [Review and dispositions](../../ci-browser-fixture-review-2026-11-19.md)
- [Original completed report](ci-report.md)
- [Source identity and fixed-file hashes](source-identity.json)
- [All 48 classified failures](classification.json)
- [Job metadata and step outcomes](jobs.json)
- [Artifact metadata, without downloading the large ZIPs](artifacts.json)
- [Actual guarded type/lint result](fixture-checks.json)
- [Compression and decoded-payload hashes](compression-map.json)
- [File checksums](SHA256SUMS)

`job-browser-{1,2,3,4,6,7,8}.log.gz` are the complete decoded text returned by GitHub's job-log connector. `install-failures/*.log.gz` preserve the exact committed failure digests at c53f180. `fixture-input-manifest.json.gz` records the 7,411 inputs protected by the local checks. Compression uses gzip with an empty embedded filename and mtime zero; every decoded payload was checked against its source bytes.

To read a log without writing into the checkout:

```sh
gzip -dc job-browser-2.log.gz
gzip -dc install-failures/wet-presentation.log.gz
sha256sum -c SHA256SUMS
```

The `.gq-gpu` snapshot correction retains a separate live GPU assertion and attachment. Both crew tests retain every original assertion and require complete new-session preparation before reading their grid. No browser run, production edit, configuration change or publication accompanied this evidence.
