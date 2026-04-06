'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const REPO_ROOT = path.join(__dirname, '..');
const MOD_ROOT = path.join(REPO_ROOT, 'mod');
const JAVA_MAIN = path.join(MOD_ROOT, 'src', 'main', 'java');
const GRADLE_PROPERTIES = path.join(MOD_ROOT, 'gradle.properties');

const TEMPLATE_MOD_ID = 'examplemod';
const TEMPLATE_GROUP = 'com.example.examplemod';
const TEMPLATE_CLASS = 'ExampleMod';

const MOD_ID_RE = /^[a-z][a-z0-9_]{1,63}$/;
const PACKAGE_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
const CLASS_RE = /^[A-Z][A-Za-z0-9_]*$/;

function usage() {
  console.log(`
Usage: node tools/init-mod.cjs [options]

  --mod-id, -i       Mod id (lowercase, [a-z][a-z0-9_]{1,63})
  --group, -g        Java package / mod_group_id (e.g. com.myname.mymod)
  --name, -n         Display name in launcher
  --class-name, -c   Main class name (default: ModMain)
  --description, -d  One-line mod_description for neoforge.mods.toml
  --license, -l      mod_license (default: MIT)
  --version, -v      mod_version (default: 0.0.1)
  --dry-run          Print actions only
  --yes, -y          Do not ask for confirmation

Run without required flags to enter interactive mode (TTY).
`);
}

function parseArgs(argv) {
  const out = {
    modId: null,
    group: null,
    name: null,
    className: 'ModMain',
    description: undefined,
    license: 'MIT',
    version: '0.0.1',
    dryRun: false,
    yes: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`Missing value after ${a}`);
      return v;
    };
    switch (a) {
      case '--mod-id':
      case '-i':
        out.modId = next();
        break;
      case '--group':
      case '-g':
        out.group = next();
        break;
      case '--name':
      case '-n':
        out.name = next();
        break;
      case '--class-name':
      case '-c':
        out.className = next();
        break;
      case '--description':
      case '-d':
        out.description = next();
        break;
      case '--license':
      case '-l':
        out.license = next();
        break;
      case '--version':
      case '-v':
        out.version = next();
        break;
      case '--dry-run':
        out.dryRun = true;
        break;
      case '--yes':
      case '-y':
        out.yes = true;
        break;
      case '--help':
      case '-h':
        usage();
        process.exit(0);
      default:
        throw new Error(`Unknown argument: ${a}`);
    }
  }
  return out;
}

function question(rl, prompt) {
  return new Promise((resolve) => rl.question(prompt, resolve));
}

async function promptAll(rl, partial) {
  const p = { ...partial };
  if (!p.modId) {
    p.modId = (await question(rl, `Mod id [${TEMPLATE_MOD_ID}]: `)).trim() || TEMPLATE_MOD_ID;
  }
  if (!p.group) {
    p.group = (await question(rl, `Java package (mod_group_id) [${TEMPLATE_GROUP}]: `)).trim() || TEMPLATE_GROUP;
  }
  if (!p.name) {
    p.name = (await question(rl, `Display name [Example Mod]: `)).trim() || 'Example Mod';
  }
  const cn = (await question(rl, `Main class name [ModMain]: `)).trim();
  if (cn) p.className = cn;
  if (!p.description) {
    p.description =
      (await question(rl, 'Short description (one line) [My NeoForge mod]: ')).trim() || 'My NeoForge mod';
  }
  return p;
}

function escapeJavaString(s) {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function validate(opts) {
  if (!MOD_ID_RE.test(opts.modId)) {
    throw new Error(`Invalid mod id "${opts.modId}". Use lowercase letters, digits, underscore; 2-64 chars.`);
  }
  if (!PACKAGE_RE.test(opts.group)) {
    throw new Error(`Invalid package "${opts.group}". Use segments like com.author.modid (lowercase).`);
  }
  if (!CLASS_RE.test(opts.className)) {
    throw new Error(`Invalid class name "${opts.className}". Use a Java identifier starting with uppercase.`);
  }
  if (!opts.name) {
    throw new Error('Display name must not be empty.');
  }
  if (opts.description && /[\r\n]/.test(opts.description)) {
    throw new Error('Description must be a single line (no line breaks).');
  }
}

function setGradleProperty(text, key, value) {
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  if (!re.test(text)) {
    throw new Error(`Key ${key} not found in gradle.properties`);
  }
  return text.replace(re, line);
}

function patchGradleProperties(content, opts) {
  let next = content;
  next = setGradleProperty(next, 'mod_id', opts.modId);
  next = setGradleProperty(next, 'mod_name', opts.name);
  next = setGradleProperty(next, 'mod_group_id', opts.group);
  next = setGradleProperty(next, 'mod_description', opts.description);
  next = setGradleProperty(next, 'mod_license', opts.license);
  next = setGradleProperty(next, 'mod_version', opts.version);
  return next;
}

function javaSource(opts) {
  const { group, className, modId } = opts;
  return `package ${group};

import com.mojang.logging.LogUtils;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.ModContainer;
import net.neoforged.fml.common.Mod;
import net.neoforged.fml.event.lifecycle.FMLCommonSetupEvent;
import org.slf4j.Logger;

@Mod(${className}.MOD_ID)
public final class ${className} {
    public static final String MOD_ID = "${modId}";
    public static final Logger LOGGER = LogUtils.getLogger();

    public ${className}(IEventBus modEventBus, ModContainer modContainer) {
        modEventBus.addListener(this::commonSetup);
    }

    private void commonSetup(FMLCommonSetupEvent event) {
        LOGGER.info("${escapeJavaString(opts.name)} loaded.");
    }
}
`;
}

function rmRecursiveIfExists(target, dryRun) {
  if (!fs.existsSync(target)) return;
  if (dryRun) {
    console.log(`[dry-run] rm -r ${path.relative(REPO_ROOT, target)}`);
    return;
  }
  fs.rmSync(target, { recursive: true, force: true });
}

function writeFile(file, content, dryRun) {
  if (dryRun) {
    console.log(`[dry-run] write ${path.relative(REPO_ROOT, file)} (${content.length} bytes)`);
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
}

function pruneEmptyDirs(startDir, stopAt) {
  let dir = startDir;
  while (dir && dir !== stopAt && dir.startsWith(stopAt)) {
    try {
      const entries = fs.readdirSync(dir);
      if (entries.length > 0) break;
      fs.rmdirSync(dir);
      dir = path.dirname(dir);
    } catch {
      break;
    }
  }
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv);
  } catch (e) {
    console.error(e.message);
    usage();
    process.exit(1);
  }

  const incomplete = !opts.modId || !opts.group || !opts.name;
  const interactive = process.stdin.isTTY && process.stdout.isTTY && incomplete;

  if (interactive) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      opts = await promptAll(rl, opts);
    } finally {
      rl.close();
    }
  } else {
    if (!opts.modId || !opts.group || !opts.name) {
      console.error('Missing --mod-id, --group, or --name. Use interactive mode or pass all three.\n');
      usage();
      process.exit(1);
    }
  }

  opts.modId = (opts.modId || '').trim().toLowerCase();
  opts.group = (opts.group || '').trim();
  opts.name = (opts.name || '').trim();
  opts.description = String(opts.description ?? '').trim();
  if (!opts.description) {
    opts.description = `NeoForge mod ${opts.name}.`;
  }

  try {
    validate(opts);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }

  if (!opts.yes && !opts.dryRun && process.stdin.isTTY) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ans = await new Promise((resolve) =>
      rl.question(`Apply: mod_id=${opts.modId}, package=${opts.group}, class=${opts.className}? [y/N] `, resolve)
    );
    rl.close();
    if (!/^y(es)?$/i.test(ans.trim())) {
      console.log('Aborted.');
      process.exit(0);
    }
  }

  if (!fs.existsSync(GRADLE_PROPERTIES)) {
    console.error(`Missing ${GRADLE_PROPERTIES}`);
    process.exit(1);
  }

  const gradleBefore = fs.readFileSync(GRADLE_PROPERTIES, 'utf8');
  const gradleAfter = patchGradleProperties(gradleBefore, opts);
  writeFile(GRADLE_PROPERTIES, gradleAfter, opts.dryRun);

  const relPackagePath = opts.group.replace(/\./g, path.sep);
  const newJavaFile = path.join(JAVA_MAIN, relPackagePath, `${opts.className}.java`);
  const oldTemplateDir = path.join(JAVA_MAIN, 'com', 'example', 'examplemod');
  const oldTemplateFile = path.join(oldTemplateDir, `${TEMPLATE_CLASS}.java`);

  if (!opts.dryRun && fs.existsSync(oldTemplateFile) && path.resolve(newJavaFile) !== path.resolve(oldTemplateFile)) {
    fs.unlinkSync(oldTemplateFile);
    pruneEmptyDirs(oldTemplateDir, JAVA_MAIN);
  }

  if (
    !opts.dryRun &&
    fs.existsSync(newJavaFile) &&
    path.resolve(newJavaFile) !== path.resolve(oldTemplateFile)
  ) {
    fs.unlinkSync(newJavaFile);
  }

  writeFile(newJavaFile, javaSource(opts), opts.dryRun);

  if (!opts.dryRun && fs.existsSync(oldTemplateDir)) {
    try {
      const left = fs.readdirSync(oldTemplateDir);
      if (left.length === 0) {
        rmRecursiveIfExists(oldTemplateDir, false);
        pruneEmptyDirs(path.dirname(oldTemplateDir), JAVA_MAIN);
      }
    } catch {
      /* ignore */
    }
  }

  console.log(opts.dryRun ? '\nDry run finished.' : '\nDone. Next: npm run compile   (or: npm run client)');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
