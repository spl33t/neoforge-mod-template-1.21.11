'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const modRoot = path.join(__dirname, '..', 'mod');
const isWin = process.platform === 'win32';
const gradle = isWin ? 'gradlew.bat' : './gradlew';
const args = process.argv.slice(2);

const result = spawnSync(gradle, args, {
  cwd: modRoot,
  stdio: 'inherit',
  shell: isWin,
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}
process.exit(result.status === null ? 1 : result.status);
