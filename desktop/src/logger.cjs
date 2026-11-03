'use strict';
/** Tiny size-capped file logger (userData/logs/main.log, one rotation). */
const fs = require('node:fs');
const path = require('node:path');

const MAX_BYTES = 512 * 1024;

function createLogger(dir, { echo = false } = {}) {
  const file = path.join(dir, 'main.log');
  let ready = false;
  const write = (message) => {
    const line = `${new Date().toISOString()} ${message}\n`;
    if (echo) process.stderr.write(line);
    try {
      if (!ready) {
        fs.mkdirSync(dir, { recursive: true });
        ready = true;
      }
      try {
        if (fs.statSync(file).size > MAX_BYTES) fs.renameSync(file, `${file}.1`);
      } catch {
        /* first write: no file yet */
      }
      fs.appendFileSync(file, line);
    } catch {
      /* logging must never take the game down */
    }
  };
  return { file, log: write };
}

module.exports = { createLogger };
