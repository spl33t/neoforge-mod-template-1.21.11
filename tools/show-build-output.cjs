'use strict';

const fs = require('fs');
const path = require('path');

const libsDir = path.join(__dirname, '..', 'mod', 'build', 'libs');

if (!fs.existsSync(libsDir)) {
  console.log('\n[mod] Папки mod/build/libs нет — JAR ещё не собирался. Выполни: npm run jar');
  process.exit(0);
}

const jars = fs.readdirSync(libsDir).filter((f) => f.endsWith('.jar'));
if (jars.length === 0) {
  console.log('\n[mod] В mod/build/libs нет .jar. Выполни: npm run jar');
  process.exit(0);
}

console.log('\n[mod] Сборка мода (скопируй в папку mods):');
for (const name of jars.sort()) {
  console.log('  ' + path.resolve(libsDir, name));
}
