# Presentation and input checkpoint

This change closes concrete graphics-control and camera gaps in sections 58, 66, 76, 92, 97, 99, 133 and 139. It is not a declaration that all master-directive phase gates or final audits passed.

## Hardware work follows the selected settings

`src/rendering/options.ts` defines validated per-setting budgets. A quality preset initializes them; individually saved overrides remain distinct from the preset label. Resolution scale updates both the WebGL drawing buffer and EffectComposer render targets. FXAA samples the inverse physical buffer dimensions. The hardware maximum texture dimension bounds allocations.

Texture detail resamples only immutable generated canvas assets and can restore each original source. Dynamic steering-wheel displays, numeric surface textures and render targets retain separate ownership. Mipmaps and hardware-bounded anisotropic filtering remain enabled. This is real resolution management, not KTX2 compression or an externally streamed asset pipeline.

Shadow resolution, local reflections, mirror resolution/frequency, bloom, FXAA, particle density, grandstand crowds and vegetation instance counts have independent controls. Removing vegetation never removes physical barriers, timing infrastructure or track geometry. Quality changes do not modify vehicle physics.

Local reflection probes alternate two completed cubemaps instead of sampling their write target. A failed capture restores renderer state and keeps the preceding complete reflection. Switching back to environment-only restores the original material map, rather than displaying a stale local probe. Anisotropy and texture settings do not resize live telemetry displays.

## Controls do not wait for a rendered frame

`src/input/pump.ts` samples actual keyboard, touch and selected-controller state on a separate 60 Hz timer. Physics still runs at its fixed rate in the worker. A render callback can be delayed or capped without withholding newly sampled pedals. This does not fabricate input heartbeats: genuinely blocked main-thread execution still triggers the worker's stale-input braking fallback. Pausing, disconnect handling and application disposal disable or stop input appropriately.

## Camera rigs and accessibility

Twenty fixed trackside platforms have authored side, elevation, field of view and track-distance coverage. A director selects coverage with hysteresis, pans toward predicted car position, resets on replay seeks, and never drags the physical platform behind the car. Unit tests cover an entire lap, cut boundaries, lap wrap and replay jumps. Per-rig obstruction/final visual review remains a separate quality task.

Flags keep their text and optionally add distinct symbols and a yellow stripe pattern. High-contrast instruments are selectable without altering other color settings. Existing camera-shake, interface-scale and remapping controls remain available. Settings version 4 migrates versions 1–3 while retaining saved device calibration, bindings and vehicle setup.

## Verification

The local full check at this checkpoint passed **179 unit/property tests**, ESLint, strict TypeScript and the production build. New tests exercise settings migration, invalid inputs, actual canvas resampling/restoration, dynamic-texture exclusion, input timer lifecycle, reflection target ownership and cleanup, fixed camera placement and replay seeks.

`e2e/presentation.spec.ts` adds browser workflows for durable settings, physical drawing-buffer dimensions and pedal delivery while render callbacks are suspended. Existing browser tests continue to check real mirror images, shaders, manual steering, calibrated clutch behavior, stored replay pages and telemetry output. Browser outcomes are reported by the matching GitHub Actions run, not inferred from passing TypeScript.

No target-device frame-rate certification, full physical-wheel test, independent player-experience audit, or final master-scenario completion is claimed by this checkpoint.
