# Isolated High startup diagnostic workflow

This adds `.github/workflows/graphics-high-diagnostic.yml` on top of local `41294f9454da7c625d9cf141afa41a05360903e1` so the reviewed High diagnostics can run separately from the current main CI execution. The only other added file is this report. Existing workflows, production source and the High spec are unchanged.

## Execution parity

The new workflow contains one `high` job copied byte-for-byte from `graphics-engine-validation.yml`. Parsing both YAML documents with the already installed **PyYAML 6.0.3 BaseLoader** also confirmed equality of the entire `jobs.high` mapping, including all eight steps and five shell commands. BaseLoader preserves GitHub Actions' `on` key as text.

| Setting | Verified value |
| --- | --- |
| Runner / job timeout | `ubuntu-24.04` / 20 minutes |
| Browser backend | `APEX_BROWSER_BACKEND=mesa`, `LIBGL_ALWAYS_SOFTWARE=true`, `GALLIUM_DRIVER=llvmpipe` |
| Checkout / Node | `actions/checkout@v4`, credentials not persisted; Node 22 with npm cache |
| Install / build | Original source-stability guarded `npm ci` and `npm run build` commands |
| Browser / native packages | Original Chromium install, Mesa libraries and Xvfb commands |
| Test command | Original `xvfb-run` command targeting `e2e/graphics-high-journey.spec.ts` |
| Job dependencies | None, matching the original High job |
| Evidence upload | Original `actions/upload-artifact@v4`, `if: always()`, name `graphics-advancement-high`, paths and 14-day retention |

The exact High job block SHA-256 is `944e4335f6b793e7baa81f31def474858713d7ec03a59f8b48f8d18a56626dad` in both files. The new workflow SHA-256 is `3e75a11cb4d1ccdff9dba8096ffce49adc8110f0894305d475a4212507dd4872`.

## Isolation and gate semantics

The workflow responds only to a push to `ci/high-late-startup-20261119`, and only when its own workflow file or `e2e/graphics-high-journey.spec.ts` changes. It has no `workflow_dispatch` or pull-request trigger. Its permissions are exactly `contents: read`.

Its concurrency group is `isolated-high-startup-${{ github.ref }}`, with cancellation limited to that distinct group and ref. It cannot collide with `ci-${{ github.ref }}` or `graphics-advancement-${{ github.ref }}`. An automatic scan of repository push branch filters admitted this diagnostic branch only for the new workflow; existing completion subscribers do not name this workflow.

The High spec remains byte-identical to the reviewed local base, SHA-256 `8145efd6bf378e614ea605d69da12984b232ab5311a2981e895cf6c017dc3497`. Its High quality, 960×600 viewport, original 90-second readiness predicate, 300-second test deadline and GPU-completion assertions therefore remain intact. The new workflow contains no publishing or deployment step, and its result does not replace any existing full CI or publication gate.

Validation was limited to YAML parsing, complete job equality, literal job-byte equality, trigger/permission/concurrency assertions, repository trigger inspection and unchanged-file checks. No browser or test was run and no remote branch was published during this preparation. The local commit is ready for the authorized isolated branch execution by the integrating agent.
