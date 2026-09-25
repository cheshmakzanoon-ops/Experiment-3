# 27H.6 menu access and publication repair

Base: reconciled candidate `a0c9211a2a673bbe9811787c5e0fa8108bd9b509`,
source tree `6bbf79ca9129be100fbb1b2a115f5bde0bbd4fd2`.

The 640x400 capture workload exposed an inaccessible production menu: the
settings button was below the viewport while the body and application wrapper
could not scroll. This was an interaction failure before any race, not a
simulation timeout. The repair bounds the existing menu body between the
masthead and footer, enables native vertical scrolling and pointer input, and
retains focus margins. Large layouts keep their existing proportional placement.
No controls, graphics, opponent counts or evidence requirements are removed.

`e2e/30-menu-access.spec.ts` uses the actual Interface component across seven
window sizes (320x320 through 1920x1080), keyboard focus, native wheel input,
all menu actions and settings round trips. A separate ordinary-application case
checks saved settings across reload and the existing paused-grid start at
640x400. Component checks are not relabelled as gameplay or art approval.

Publication uses authenticated GitHub Git-object/ref operations rather than
repeating a DNS-blocked terminal push. A single updated preflight reconstructs
this narrowly scoped repair from the exact reconciled candidate, regenerates
source hashes, retains a candidate commit without advancing a branch, and runs
the full existing browser and numerical suites. Final activation is a separate
non-force ref update after inspecting that exact revision's results. The final
game tree retains the original CI workflows, not temporary staging helpers.

The repaired CSS passed local browser layout/click/focus checks on extracted
production menu markup at all seven sizes. Full application and hosted results
must be read from the candidate's workflow; local DOM checks alone do not
certify them. No reference, final-art, target-hardware or Steam approval is added.
