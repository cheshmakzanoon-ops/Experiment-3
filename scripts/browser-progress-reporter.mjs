import { writeFileSync } from 'node:fs';

// A canceled run may never reach Playwright's end-of-run error report. Retain
// bounded diagnostic strings as each failure occurs, without changing results.
const errorEvidence = (error) => ({
  message: String(error.message ?? error.value ?? 'Unspecified browser error').slice(0, 12000),
  ...(error.stack ? { stack: String(error.stack).slice(0, 18000) } : {}),
});

/** Diagnostic evidence, not a retry or a softened deadline. Persists the exact
 * active test and recent step even if a browser later stalls in teardown. */
export default class BrowserProgress {
  constructor() {
    this.active = new Map();
    this.completed = [];
    this.errors = [];
  }
  flush(event) {
    writeFileSync(
      'browser-progress.json',
      JSON.stringify(
        {
          version: 1,
          event,
          timestamp: new Date().toISOString(),
          active: [...this.active.values()],
          completed: this.completed,
          errors: this.errors,
        },
        null,
        2,
      ),
    );
  }
  onBegin() {
    this.flush('begin');
    this.timer = setInterval(() => {
      for (const item of this.active.values())
        console.log(
          `[browser-progress] ${Math.round((Date.now() - item.started) / 1000)}s ${item.title} / ${item.step}`,
        );
      this.flush('heartbeat');
    }, 30000);
    this.timer.unref();
  }
  onTestBegin(test) {
    const item = {
      id: test.id,
      title: test.titlePath().join(' > '),
      file: test.location.file,
      started: Date.now(),
      step: 'starting',
    };
    this.active.set(test.id, item);
    console.log(`[browser-progress] START ${item.title}`);
    this.flush('test-begin');
  }
  onStepBegin(test, _result, step) {
    const item = this.active.get(test.id);
    if (item) item.step = step.title;
    this.flush('step-begin');
  }
  onTestEnd(test, result) {
    const errors = (result.errors ?? []).slice(0, 8).map(errorEvidence);
    const title = test.titlePath().join(' > ');
    this.completed.push({
      id: test.id,
      title,
      file: test.location.file,
      status: result.status,
      durationMs: result.duration,
      errors,
    });
    for (const error of errors)
      console.error(`[browser-failure] ${title}\n${error.stack ?? error.message}`);
    this.active.delete(test.id);
    this.flush('test-end');
  }
  onError(error) {
    const evidence = errorEvidence(error);
    this.errors.push(evidence);
    console.error(`[browser-error] ${evidence.stack ?? evidence.message}`);
    this.flush('error');
  }
  onEnd(result) {
    clearInterval(this.timer);
    this.flush(result.status);
  }
}
