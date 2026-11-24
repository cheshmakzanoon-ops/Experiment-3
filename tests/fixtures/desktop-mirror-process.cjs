'use strict';

// An isolated process over real temporary files. Only the crash-point adapter
// intercepts filesystem calls; it performs each real call before SIGKILL.
const fs = require('node:fs');
const path = require('node:path');
const { SaveMirror, saveMirrorService } = require('../../desktop/src/save-mirror.cjs');
const { encode, decode } = require('../../desktop/src/codec.cjs');

const options = JSON.parse(fs.readFileSync(0, 'utf8'));
const dir = path.resolve(options.dir);
if (!path.basename(dir).startsWith('motobound-mirror-process-'))
  throw new Error('The subprocess fixture requires its own disposable directory');

const traceFile = path.join(dir, 'process-trace.jsonl');
const trace = (event) => fs.appendFileSync(traceFile, `${JSON.stringify(event)}\n`);
const kill = (stage, file) => {
  trace({ stage, file, pid: process.pid });
  process.kill(process.pid, 'SIGKILL');
  throw new Error('SIGKILL did not terminate the writer');
};

let armed = false;
const descriptorPaths = new Map();
const crashFs = Object.create(fs);
const targetFile = `${options.target}.json`;
const checkpoint = (stage, filename) => {
  if (armed && options.stage === stage && path.basename(filename) === targetFile)
    kill(stage, targetFile);
};
crashFs.openSync = (filename, ...args) => {
  const fd = fs.openSync(filename, ...args);
  descriptorPaths.set(fd, filename);
  if (armed && options.stage === 'opened' && path.basename(filename) === `${targetFile}.tmp`)
    kill('opened', targetFile);
  return fd;
};
crashFs.writeSync = (fd, payload, ...args) => {
  const filename = descriptorPaths.get(fd);
  if (
    armed &&
    options.stage === 'partial-write' &&
    path.basename(filename) === `${targetFile}.tmp`
  ) {
    fs.writeSync(fd, payload.slice(0, Math.floor(payload.length / 2)), ...args);
    kill('partial-write', targetFile);
  }
  const result = fs.writeSync(fd, payload, ...args);
  if (filename) checkpoint('written', filename.replace(/\.tmp$/, ''));
  return result;
};
crashFs.fsyncSync = (fd) => {
  const result = fs.fsyncSync(fd);
  const filename = descriptorPaths.get(fd);
  if (filename) checkpoint('synced', filename.replace(/\.tmp$/, ''));
  return result;
};
crashFs.closeSync = (fd) => {
  descriptorPaths.delete(fd);
  return fs.closeSync(fd);
};
crashFs.copyFileSync = (from, to, ...args) => {
  const result = fs.copyFileSync(from, to, ...args);
  checkpoint('backup', from);
  return result;
};
crashFs.renameSync = (from, to) => {
  const result = fs.renameSync(from, to);
  checkpoint('renamed', to);
  return result;
};

const main = new SaveMirror({ dir, name: 'saves', debounceMs: 60_000, fs: crashFs });
const ghosts = new SaveMirror({ dir, name: 'ghosts', debounceMs: 60_000, fs: crashFs });
main.load();
ghosts.load();
const service = saveMirrorService({ main, ghosts }, dir);
let result;
switch (options.operation) {
  case 'seed':
    service.seed(decode(options.entries), options.revision);
    if (!service.flush()) throw new Error('fixture seed failed to flush');
    result = true;
    break;
  case 'crash':
    service.commit(Object.entries(decode(options.entries)), 2, 1);
    armed = true;
    if (options.stage === 'accepted') kill('accepted', 'memory');
    for (const name of options.order) {
      if (!(name === 'saves' ? main : ghosts).flush())
        throw new Error(`fixture ${name} flush failed`);
    }
    throw new Error('The requested crash point was not reached');
  case 'inspect': {
    const snapshot = service.load();
    let predecessorAccepted = false;
    try {
      service.commit([['probe', true]], snapshot.revision + 1, snapshot.revision);
      predecessorAccepted = true;
    } catch (error) {
      if (!String(error).includes('complete predecessor')) throw error;
    }
    result = {
      snapshot,
      predecessorAccepted,
      sources: { main: main.source, ghosts: ghosts.source },
    };
    break;
  }
  case 'info':
    result = service.info();
    break;
  case 'load':
    result = service.load();
    break;
  case 'commit':
    result = service.commit(
      Object.entries(decode(options.entries)),
      options.revision,
      options.previous,
    );
    if (!service.flush()) throw new Error('fixture commit failed to flush');
    break;
  default:
    throw new Error(`Unknown fixture operation ${options.operation}`);
}
process.stdout.write(JSON.stringify(encode(result)));
// Flush is deliberately explicit above. Unref'ed debounce callbacks are lost
// when this process exits, as they would be when the application is terminated.
