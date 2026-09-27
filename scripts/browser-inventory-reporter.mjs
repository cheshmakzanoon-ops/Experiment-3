import { writeFileSync } from 'node:fs';
/** The locked Playwright runner is queried again with the selected expression.
 * Any title-format change therefore fails closed before browser execution. */
export default class BrowserInventory {
  onBegin(_config, suite) {
    const tests = suite.allTests().map((test) => {
      let serialGroup = null;
      for (let parent = test.parent; parent; parent = parent.parent) {
        if (!['none', 'default', 'parallel', 'serial'].includes(parent._parallelMode))
          throw new Error('Locked Playwright suite metadata is unavailable');
        if (parent._parallelMode === 'serial')
          serialGroup = `${test.location.file}:${parent.titlePath().join(' ')}`;
      }
      if (typeof test._grepTitleWithTags !== 'function')
        throw new Error('Locked Playwright grep-title contract is unavailable');
      return {
        id: test.id,
        // Reporter suites have an extra empty root added after CLI filtering.
        title: test._grepTitleWithTags().slice(1),
        file: test.location.file,
        serialGroup,
      };
    });
    if (!process.env.APEX_BROWSER_INVENTORY) throw new Error('Missing inventory destination');
    writeFileSync(process.env.APEX_BROWSER_INVENTORY, JSON.stringify(tests));
  }
}
