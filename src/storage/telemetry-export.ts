import CsvWorker from '../workers/telemetry.worker.ts?worker&inline';
/** One cancellable export job. A session transition cannot download a stale
 * previous-session result. Timeout/error rejects the request and frees the worker. */
export class TelemetryExport {
  private worker: Worker | null = null;
  private reject: ((error: Error) => void) | null = null;
  private timeout: ReturnType<typeof setTimeout> | null = null;
  private sequence = 0;
  export(values: Float32Array, count: number): Promise<Blob> {
    this.cancel();
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.reject = reject;
      try {
        const worker = new CsvWorker({ name: 'apex-telemetry-export' });
        this.worker = worker;
        worker.onmessage = (event: MessageEvent<{ id: number; blob?: Blob; error?: string }>) => {
          if (id !== this.sequence || event.data.id !== id) return;
          const { blob, error } = event.data;
          this.release();
          if (error || !blob) reject(new Error(error ?? 'Export worker returned no data'));
          else resolve(blob);
        };
        worker.onerror = (event) => {
          if (id !== this.sequence) return;
          this.release();
          reject(new Error(event.message));
        };
        worker.onmessageerror = () => {
          if (id !== this.sequence) return;
          this.release();
          reject(new Error('Telemetry transfer failed'));
        };
        this.timeout = setTimeout(() => {
          this.release();
          reject(new Error('Telemetry export timed out'));
        }, 30000);
        worker.postMessage({ id, values, count }, [values.buffer]);
      } catch (error) {
        this.release();
        reject(error);
      }
    });
  }
  private release() {
    if (this.timeout) clearTimeout(this.timeout);
    this.timeout = null;
    this.worker?.terminate();
    this.worker = null;
    this.reject = null;
  }
  cancel() {
    const reject = this.reject;
    this.sequence++;
    this.release();
    reject?.(new Error('Telemetry export cancelled'));
  }
}
