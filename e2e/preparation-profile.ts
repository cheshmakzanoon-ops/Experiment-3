import { test as base, type CDPSession } from '@playwright/test';

/** Opt-in diagnostic run only. Acceptance runs keep their original workload,
 * clocks and assertions; a profile is not a benchmark or a passing test. */
export const preparationProfileTest = base.extend<{ preparationProfile: undefined }>({
  preparationProfile: [
    async ({ page }, use, info) => {
      if (process.env.APEX_PREPARATION_PROFILE !== '1') {
        await use(undefined);
        return;
      }
      let session: CDPSession | undefined;
      let setup: Promise<void> | undefined;
      let failure: unknown;
      const start = () => {
        setup = (async () => {
          session = await page.context().newCDPSession(page);
          await session.send('Profiler.enable');
          await session.send('Profiler.setSamplingInterval', { interval: 1000 });
          await session.send('Profiler.start');
        })().catch((error: unknown) => {
          failure = error;
        });
      };
      page.once('domcontentloaded', start);
      try {
        await use(undefined);
      } finally {
        page.off('domcontentloaded', start);
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const profile = await Promise.race([
            (async () => {
              await setup;
              if (failure) throw failure;
              if (!session) throw new Error('No document was available for profiling');
              return (await session.send('Profiler.stop')).profile;
            })(),
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () => reject(new Error('CPU profile collection exceeded 30s')),
                30000,
              );
            }),
          ]);
          await info.attach('preparation.cpuprofile', {
            body: JSON.stringify(profile),
            contentType: 'application/json',
          });
        } catch (error) {
          await info.attach('preparation-profile-unavailable.json', {
            body: JSON.stringify({ error: String(error), status: info.status }),
            contentType: 'application/json',
          });
        } finally {
          clearTimeout(timer);
          // Disconnect independently even if the original renderer is unresponsive.
          void session?.detach().catch(() => {});
        }
      }
    },
    { auto: true },
  ],
});
