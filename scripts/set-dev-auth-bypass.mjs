import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const mode = process.argv[2];
if (mode !== 'on' && mode !== 'off') {
  console.error('Usage: node scripts/set-dev-auth-bypass.mjs <on|off>');
  process.exit(1);
}

const enabled = mode === 'on';
const root = process.cwd();
const envLocalPath = path.join(root, '.env.local');
const rulesPath = path.join(root, 'firestore.rules');

const setEnvVar = () => {
  const line = `VITE_DEV_AUTH_BYPASS=${enabled ? 'true' : 'false'}`;

  if (!existsSync(envLocalPath)) {
    writeFileSync(envLocalPath, `${line}\n`, 'utf8');
    return;
  }

  const content = readFileSync(envLocalPath, 'utf8');
  if (/^VITE_DEV_AUTH_BYPASS=.*/m.test(content)) {
    writeFileSync(envLocalPath, content.replace(/^VITE_DEV_AUTH_BYPASS=.*/m, line), 'utf8');
  } else {
    const sep = content.endsWith('\n') ? '' : '\n';
    writeFileSync(envLocalPath, `${content}${sep}${line}\n`, 'utf8');
  }
};

const setFirestoreRule = () => {
  const content = readFileSync(rulesPath, 'utf8');
  const rulePattern = /function authSuspended\(\) \{\s*return (true|false);\s*\}/m;
  if (!rulePattern.test(content)) {
    console.error('Could not locate authSuspended() in firestore.rules');
    process.exit(1);
  }

  const updated = content.replace(
    rulePattern,
    `function authSuspended() {\n      return ${enabled ? 'true' : 'false'};\n    }`
  );

  writeFileSync(rulesPath, updated, 'utf8');
};

setEnvVar();
setFirestoreRule();

console.log(`DEV_AUTH_BYPASS is now ${enabled ? 'ON' : 'OFF'}.`);
console.log('- Frontend flag updated in .env.local');
console.log('- Firestore rule authSuspended() updated in firestore.rules');
console.log('Next steps:');
console.log('1) Restart dev server: npm run dev');
console.log('2) Deploy rules when ready: firebase deploy --only firestore --project gen-lang-client-0139143675');
