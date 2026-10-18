import { buildProduction } from './production-lib.mjs';
const manifest=await buildProduction();
process.stdout.write(`PASS: built ${manifest.files.length} production assets in dist-production/; preview public/ and dist/ preserved.\n`);
