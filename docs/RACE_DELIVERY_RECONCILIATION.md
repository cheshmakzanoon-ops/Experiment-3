# Race-delivery validation reconciliation

Base: `f3c4233994e0d0eeaa0b63a180db7b1fd5b03073`, exact recovered source
and verified tree `c70edfdafd39008b3caea59064d6269cd84f9cd6`.

Run `36269161537` passed validation, numerical scenarios, wet presentation and
seven of eight browser shards, including all three new race-finish GPU cases.
The run correctly failed because the older wheel-fidelity inspector selected the
persistent rear lamp instead of the reduced model. The actual four wheel pivots
remain children of the visible reduced-model group; no wheel geometry was lost.

The inspector now selects the one visible root **group**, excluding persistent
root meshes regardless of order. It fails explicitly for ambiguous/missing models
or missing/hidden wheel pivots, and returns the actual live objects. Four negative
and ownership regressions cover that boundary. All existing wheel alignment,
rigid-part, source-immutability, pixel-change and resource assertions are retained.
No test is skipped or retried and no acceptance threshold is reduced by this fix.

The 16 focused unit cases passed locally. Local Chromium reports WebGL2 unavailable;
hosted browser validation must independently exercise the corrected GPU fixture.
This change does not modify any runtime source, asset, simulation, input, audio,
worker, storage, dependency, or workflow. The runtime fingerprint remains
`be09b3c0fc31eba9e5510cd21f3b1a49c09f5e1fed1b4a842bbfb3f16e7bc210`.

Use the exact new commit's successful ordinary CI artifact for release, not the
historical checked-in `playable/`. Source publication, complete hosted CI, deployed
byte identity and deployed smoke tests remain distinct checks. Human full-race,
physical-controller and target-hardware performance acceptance are not implied.
