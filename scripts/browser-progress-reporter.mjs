import { writeFileSync } from 'node:fs';

/** Diagnostic evidence, not a retry or a softened deadline. Persists the exact
 * active test and recent step even if a browser later stalls in teardown. */
export default class BrowserProgress {
  constructor() {
    this.active = new Map();
    this.completed = [];
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
    this.completed.push({
      id: test.id,
      title: test.titlePath().join(' > '),
      file: test.location.file,
      status: result.status,
      durationMs: result.duration,
    });
    this.active.delete(test.id);
    this.flush('test-end');
  }
  onEnd(result) {
    clearInterval(this.timer);
    this.flush(result.status);
  }
}
