import * as T from 'three';

interface Stream {
  buffer: WebGLBuffer;
  attribute: T.GLBufferAttribute;
  revision: number;
}
interface Context {
  streams: Map<object, Stream>;
  lost: () => void;
}

/** Owned index-only buffers. COPY_WRITE_BUFFER does not change Three's cached
 * vertex-array/element bindings. Neither source indices nor vertex attributes
 * are uploaded or modified here. A context loss invalidates all owned handles;
 * the next submission recreates them from the retained CPU selection. */
export class CompactIndexBuffers {
  private readonly contexts = new Map<WebGL2RenderingContext, Context>();
  private disposed = false;
  private uploads = 0;
  private uploadedBytes = 0;

  get(
    gl: WebGL2RenderingContext | WebGLRenderingContext,
    key: object,
    indices: Uint32Array,
    count: number,
    revision: number,
  ): T.BufferAttribute | null {
    if (this.disposed || !('COPY_WRITE_BUFFER' in gl) || gl.isContextLost() || count <= 0)
      return null;
    if (!Number.isInteger(count) || count > indices.length || !Number.isSafeInteger(revision))
      throw new Error('Invalid compacted index selection');
    let context = this.contexts.get(gl);
    if (!context) {
      const streams = new Map<object, Stream>();
      const lost = () => streams.clear(); // The context, not the application, deleted these.
      context = { streams, lost };
      this.contexts.set(gl, context);
      gl.canvas.addEventListener('webglcontextlost', lost);
    }
    let stream = context.streams.get(key);
    if (stream?.revision === revision) return stream.attribute as unknown as T.BufferAttribute;
    // Preserve external COPY_WRITE users, without touching the currently bound
    // VAO. WebGLRenderer's GLBufferAttribute path owns the subsequent index bind.
    const previous = gl.getParameter(gl.COPY_WRITE_BUFFER_BINDING) as WebGLBuffer | null;
    const buffer = stream?.buffer ?? gl.createBuffer();
    if (!buffer) return null; // Keep the original conservative range on allocation failure.
    try {
      gl.bindBuffer(gl.COPY_WRITE_BUFFER, buffer);
      if (!stream) {
        gl.bufferData(gl.COPY_WRITE_BUFFER, indices.byteLength, gl.DYNAMIC_DRAW);
        if (
          !gl.isContextLost() &&
          gl.getBufferParameter(gl.COPY_WRITE_BUFFER, gl.BUFFER_SIZE) !== indices.byteLength
        )
          throw new Error('Unable to allocate compacted index buffer');
      }
      gl.bufferSubData(gl.COPY_WRITE_BUFFER, 0, indices, 0, count);
      if (gl.isContextLost()) return null;
      if (!stream) {
        stream = {
          buffer,
          attribute: new T.GLBufferAttribute(buffer, gl.UNSIGNED_INT, 1, 4, indices.length),
          revision,
        };
        context.streams.set(key, stream);
      }
      stream.revision = revision;
      this.uploads++;
      this.uploadedBytes += count * 4;
      // Three's type declaration restricts index to BufferAttribute; its WebGL
      // binding-state implementation explicitly supports GLBufferAttribute.
      return stream.attribute as unknown as T.BufferAttribute;
    } catch (error) {
      if (!stream && !gl.isContextLost()) gl.deleteBuffer(buffer);
      throw error;
    } finally {
      if (!gl.isContextLost()) gl.bindBuffer(gl.COPY_WRITE_BUFFER, previous);
    }
  }

  diagnostics() {
    let buffers = 0;
    for (const context of this.contexts.values()) buffers += context.streams.size;
    return { buffers, uploads: this.uploads, uploadedBytes: this.uploadedBytes };
  }

  dispose() {
    if (this.disposed) return;
    for (const [gl, context] of this.contexts) {
      gl.canvas.removeEventListener('webglcontextlost', context.lost);
      if (!gl.isContextLost())
        for (const { buffer } of context.streams.values()) gl.deleteBuffer(buffer);
      context.streams.clear();
    }
    this.contexts.clear();
    this.disposed = true;
  }
}
