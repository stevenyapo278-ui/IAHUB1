#!/usr/bin/env node
// ── Évaluation hors ligne du pré-remplissage « comptes applicatifs » ────────
// Rejoue un jeu de tickets annotés sur la couche déterministe (alias, frontières
// de mots, résolution de chevauchement). Aucun accès réseau ni base de données :
// le catalogue vient du fichier de fixtures, donc le test est reproductible.
//
// Usage :
//   node scripts/evalAccountProvisioning.js
//   node scripts/evalAccountProvisioning.js --file scripts/fixtures/mon-jeu.json
//   node scripts/evalAccountProvisioning.js --verbose
//
// Sortie : matrice de confusion + précision/rappel sur les applications, puis
// code de sortie 1 si au moins un cas échoue (utilisable en CI).
const fs = require('fs');
const path = require('path');
const { buildDeterministicPrefill } = require('../src/services/accountProvisioningAi');

const DEFAULT_FILE = path.join(__dirname, 'fixtures', 'accountProvisioning.eval.json');

function parseArgs(argv) {
  const args = { file: DEFAULT_FILE, verbose: false };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--file' && argv[i + 1]) {
      args.file = path.resolve(argv[i + 1]);
      i += 1;
    } else if (argv[i] === '--verbose') {
      args.verbose = true;
    }
  }
  return args;
}

function normalizeName(value) {
  return String(value || '').toLowerCase().trim();
}

function main() {
  const { file, verbose } = parseArgs(process.argv);
  if (!fs.existsSync(file)) {
    console.error(`Jeu d'évaluation introuvable : ${file}`);
    process.exit(2);
  }

  const dataset = JSON.parse(fs.readFileSync(file, 'utf8'));
  const catalog = Array.isArray(dataset.catalog) ? dataset.catalog : [];
  const cases = Array.isArray(dataset.cases) ? dataset.cases : [];

  let truePositive = 0;
  let trueNegative = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  let appExpected = 0;
  let appFound = 0;
  let appCorrect = 0;
  const failures = [];

  for (const testCase of cases) {
    const ticket = { title: testCase.title || '', content: testCase.content || '' };
    const result = buildDeterministicPrefill(ticket, [], catalog);

    const expected = Boolean(testCase.expect?.isAccountProvisioning);
    const actual = Boolean(result.isAccountProvisioning);
    if (expected && actual) truePositive += 1;
    else if (!expected && !actual) trueNegative += 1;
    else if (!expected && actual) falsePositive += 1;
    else falseNegative += 1;

    const expectedApps = (testCase.expect?.applications || []).map(normalizeName).sort();
    const actualApps = (result.applications || []).map((app) => normalizeName(app.name)).sort();
    appExpected += expectedApps.length;
    appFound += actualApps.length;
    appCorrect += expectedApps.filter((name) => actualApps.includes(name)).length;

    const appsMatch = expectedApps.join('|') === actualApps.join('|');
    const classificationOk = expected === actual;
    const ok = appsMatch && classificationOk;
    if (!ok) {
      failures.push({ case: testCase, actual: { classification: actual, applications: actualApps }, expected: { classification: expected, applications: expectedApps } });
    }

    if (verbose || !ok) {
      const status = ok ? 'OK  ' : 'FAIL';
      console.log(`[${status}] ${testCase.name || testCase.title}`);
      console.log(`        attendu : provisioning=${expected} apps=[${expectedApps.join(', ')}]`);
      console.log(`        obtenu  : provisioning=${actual} apps=[${actualApps.join(', ')}]`);
      if (!ok && !verbose) {
        console.log(`        raison  : ${result.reason}`);
      }
    }
  }

  const total = cases.length;
  const precision = appFound > 0 ? appCorrect / appFound : 0;
  const recall = appExpected > 0 ? appCorrect / appExpected : 0;
  const accuracy = total > 0 ? (truePositive + trueNegative) / total : 0;

  console.log('\n── Résumé ─────────────────────────────────────────────');
  console.log(`Cas évalués            : ${total}`);
  console.log(`Classification exacte  : ${(accuracy * 100).toFixed(1)} %`);
  console.log(`  vrais positifs       : ${truePositive}`);
  console.log(`  vrais négatifs       : ${trueNegative}`);
  console.log(`  faux positifs        : ${falsePositive}`);
  console.log(`  faux négatifs        : ${falseNegative}`);
  console.log(`Applications précision: ${(precision * 100).toFixed(1)} %`);
  console.log(`Applications rappel   : ${(recall * 100).toFixed(1)} %`);
  console.log(`Échecs                 : ${failures.length}`);

  if (failures.length > 0) {
    console.log('\nCas en échec :');
    for (const failure of failures) {
      console.log(`- ${failure.case.name || failure.case.title}`);
    }
    process.exit(1);
  }
}

main();
