# Current development status

Updated 2026-11-05 (studio wind-down). This page is a short pointer; the full, evidence-based status, known problems,
owner decisions and phased roadmap are in [studio/ROADMAP.md](studio/ROADMAP.md), the product description in
[studio/GAME_OVERVIEW.md](studio/GAME_OVERVIEW.md) and the release gates in [studio/RELEASE_GATES.md](studio/RELEASE_GATES.md).

## State of `main`

- Build, typecheck, lint, content validation and the IP guard pass on clean GitHub runners; initial JS is 3.5 MB gzip.
- Full unit suite: 616 files / 6,086 tests passing at the last full run (see ROADMAP § 7 for the final record).
- GitHub Actions browser shards: 6 of 8 pass on real runners; shards 6 and 7 and the cold-start timing of full-grid sessions
  are the open CI triage (ROADMAP § 3.1).
- Not verified anywhere: real-GPU performance, Steam Deck, Windows/macOS package runs, the Steam client, human playtests.
- The owner's earlier engine note (Three.js stays authoritative; Babylon.js was only a proposal) still stands: no second
  rendering loop exists in production.

This is an in-development game, not a certified commercial release, and no technical test can guarantee sales.
