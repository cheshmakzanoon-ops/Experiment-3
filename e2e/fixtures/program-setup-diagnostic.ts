export interface ProgramSetupDiagnosticOptions {
  prototype: Record<string, (...args: unknown[]) => unknown>;
  active: () => boolean;
  stage: () => string;
  identify: (object: object | null | undefined) => number;
  describeContext: (gl: WebGL2RenderingContext) => Record<string, unknown>;
  report: (record: Record<string, unknown>) => void;
  now?: () => number;
}

/** Passive, test-only attribution for the native calls after useProgram.
 * Keep this function self-contained: the High test serializes it into its init
 * script. No extra GL query, uniform assignment, worker message or GPU wait is
 * performed. Only returned calls can be timed; a blocked call remains subject
 * to the existing independent native-command worker's coarser observation. */
export function installProgramSetupDiagnostic(options: ProgramSetupDiagnosticOptions) {
  const methods = [
    'uniform1f',
    'uniform2f',
    'uniform3f',
    'uniform4f',
    'uniform1fv',
    'uniform2fv',
    'uniform3fv',
    'uniform4fv',
    'uniform1i',
    'uniform2i',
    'uniform3i',
    'uniform4i',
    'uniform1iv',
    'uniform2iv',
    'uniform3iv',
    'uniform4iv',
    'uniform1ui',
    'uniform2ui',
    'uniform3ui',
    'uniform4ui',
    'uniform1uiv',
    'uniform2uiv',
    'uniform3uiv',
    'uniform4uiv',
    'uniformMatrix2fv',
    'uniformMatrix3fv',
    'uniformMatrix4fv',
    'activeTexture',
    'bindTexture',
  ];
  const now = options.now ?? (() => performance.now());
  const locations = new WeakMap<object, { program: object; name: string }>();
  const activeUnits = new WeakMap<object, number>();
  const statistics = new Map<
    string,
    {
      calls: number;
      cpuCallMs: number;
      maximumCallMs: number;
      slowCalls: number;
      throws: number;
    }
  >();
  const slowThresholdMs = 100,
    slowRecordLimit = 16;
  let reportedSlowCalls = 0,
    dirty = false;
  const emit = (record: Record<string, unknown>) => {
    // A console/transport failure must not replace a native return or error.
    try {
      options.report(record);
    } catch {
      /* observation only */
    }
  };
  const flush = (reason: string) => {
    if (!dirty) return;
    dirty = false;
    emit({
      kind: 'program-setup-summary',
      stage: options.stage(),
      atMs: now(),
      reason,
      slowThresholdMs,
      slowRecordLimit,
      reportedSlowCalls,
      methods: Object.fromEntries([...statistics].map(([method, value]) => [method, { ...value }])),
      limitation:
        'Cumulative returned-call CPU durations include wrapper overhead and queued driver work; no isolated GPU time or in-flight uniform attribution.',
    });
  };
  const query = options.prototype.getUniformLocation;
  options.prototype.getUniformLocation = function (
    this: WebGL2RenderingContext,
    ...args: unknown[]
  ) {
    const result = Reflect.apply(query, this, args);
    if (
      result &&
      typeof result === 'object' &&
      args[0] &&
      typeof args[0] === 'object' &&
      typeof args[1] === 'string'
    )
      locations.set(result, { program: args[0], name: args[1] });
    return result;
  };
  for (const method of methods) {
    const original = options.prototype[method];
    if (typeof original !== 'function') continue;
    const counts = { calls: 0, cpuCallMs: 0, maximumCallMs: 0, slowCalls: 0, throws: 0 };
    statistics.set(method, counts);
    options.prototype[method] = function (this: WebGL2RenderingContext, ...args: unknown[]) {
      const enabled = options.active();
      const startedAt = enabled ? now() : 0;
      let returned = false;
      try {
        const result = Reflect.apply(original, this, args);
        returned = true;
        if (method === 'activeTexture') activeUnits.set(this, args[0] as number);
        return result;
      } finally {
        if (enabled) {
          const elapsed = now() - startedAt;
          counts.calls++;
          counts.cpuCallMs += elapsed;
          counts.maximumCallMs = Math.max(counts.maximumCallMs, elapsed);
          counts.slowCalls += elapsed >= slowThresholdMs ? 1 : 0;
          counts.throws += returned ? 0 : 1;
          dirty = true;
          if (elapsed >= slowThresholdMs && reportedSlowCalls < slowRecordLimit) {
            reportedSlowCalls++;
            try {
              const location =
                method.startsWith('uniform') && args[0] && typeof args[0] === 'object'
                  ? locations.get(args[0])
                  : undefined;
              emit({
                kind: 'slow-program-setup',
                stage: options.stage(),
                atMs: startedAt,
                method,
                cpuCallMs: elapsed,
                returned,
                ...options.describeContext(this),
                uniform: location
                  ? { program: options.identify(location.program), name: location.name }
                  : null,
                texture:
                  method === 'bindTexture'
                    ? {
                        target: args[0],
                        owner: options.identify(args[1] as object | null),
                        unit: activeUnits.get(this) ?? 0x84c0,
                      }
                    : null,
                numericArguments: args
                  .slice(0, 4)
                  .map((value) =>
                    typeof value === 'number' || typeof value === 'boolean' ? value : null,
                  ),
                sourceBufferBytes:
                  args.find((value) => ArrayBuffer.isView(value) || value instanceof ArrayBuffer)
                    ?.byteLength ?? null,
                stack: new Error().stack?.split('\n').slice(1, 10).join('\n').slice(0, 4096),
              });
              flush('slow-call');
            } catch {
              /* observation only */
            }
          }
        }
      }
    };
  }
  return { flush };
}
