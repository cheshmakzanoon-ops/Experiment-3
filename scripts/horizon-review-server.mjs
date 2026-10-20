/** Serve an unchanged review fixture through Vite development or a bounded
 * production bundle. Callers retain their frozen-source load hooks. */
import assert from 'node:assert/strict';
import { copyFile, mkdir } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';
import { build, createServer, preview } from 'vite';

export async function horizonReviewServer(config, { output, fixture, variant = 'review' }) {
  const bundled = process.env.HORIZON_REVIEW_BUNDLED === '1';
  if (!bundled) {
    const server = await createServer(config);
    await server.listen();
    return {
      fixtureUrl: `${server.resolvedUrls.local[0]}${fixture}`,
      servingMode: 'development',
      buildMs: 0,
      close: () => server.close(),
    };
  }
  const root = resolve(config.root);
  const directory = resolve(output, `build-${variant}`);
  assert(directory !== root && relative(directory, root).startsWith('..'));
  const started = performance.now();
  let timer;
  try {
    await Promise.race([
      build({
        ...config,
        base: './',
        build: {
          outDir: directory,
          emptyOutDir: true,
          target: 'es2022',
          rollupOptions: { input: join(root, fixture) },
        },
      }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Review build exceeded 180000 ms')), 180000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
  await mkdir(directory, { recursive: true });
  // Runtime assets use the production relative BASE_URL. An unchanged root
  // alias puts those requests beside index.html instead of inside e2e/fixtures.
  await copyFile(join(directory, fixture), join(directory, basename(fixture)));
  const server = await preview({
    root,
    configFile: false,
    base: './',
    build: { outDir: directory },
    preview: {
      host: config.server.host,
      port: config.server.port,
      strictPort: true,
    },
    logLevel: 'warn',
  });
  return {
    fixtureUrl: `${server.resolvedUrls.local[0]}${basename(fixture)}`,
    servingMode: 'bundled',
    buildMs: performance.now() - started,
    buildDirectory: directory,
    close: () =>
      new Promise((resolve, reject) =>
        server.httpServer.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
