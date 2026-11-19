# Exact fresh-construction GP image mismatch on published main

Source: `ffd22598335dfa2a074ebd466e1d53830bb8bb41`. [Run 44617126580](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/44617126580), ordinary browser partition 11, job `135890460489`, original case `115f7b67105cc547e99c-dc61b472f248a863c6ed`.

The original GP reference case reaches its last assertion and fails the exact hash equality between the first and sixth independently constructed dry High renders. The native hashes are `4250551400` and `1540003535`. The two original 1280 × 800 PNGs differ in **four of 1,024,000 pixels**, in five RGBA components, by at most **one integer colour level**. Their reported metrics otherwise differ only in instance identity. Computing the fixture's original bottom-up FNV-1a hash from each PNG reproduces the exact reported hashes.

The earlier same-instance wet/held/rewound-dry sequence passes exact equality: dry `1540003535`, wet `3758440645`, held wet `3758440645`, rewound dry `1540003535`. Earlier rider, optics, resource stability and geometry-budget assertions also complete before the final failure. This is a fresh-construction exact-pixel failure; it is not evidence that the same-instance weather reversal failed. Its cause is not established. No pixel tolerance, assertion, renderer source, lighting, resolution or quality setting was changed.

The original 408,165,063-byte browser artifact is verified against the advertised SHA-256 `6821489dfb945440ea20fe3fe850b294083c55aff241cf810af87a8bb33dda17`. The compact package retains the full native case reporter, original reporter metadata, the two original PNGs, original metrics and source identities. It omits unrelated case videos and traces from that large archive. Full browser job logs and the complete matrix inventory are retained separately in the main browser audit.

Reproduce only this read-only numerical audit with `python analyze-gp-reference.py` (Python, Pillow and NumPy). It does not launch a browser or execute production or test code. `SHA256SUMS` covers every other file in this directory.
