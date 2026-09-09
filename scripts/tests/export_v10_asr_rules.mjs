// Read frozen v1.0 rules and emit deterministic Dart data + equivalence fixtures.
// The caller applies generated files using apply_patch; no repository writes here.
import {execFileSync} from 'node:child_process';
import {stripTypeScriptTypes} from 'node:module';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import assert from 'node:assert/strict';
const repository = process.argv[2];
assert(repository, 'Pass the frozen v1.0 repository path');
const baseline = '898ee517e7aac00b03bc79ff2d0597dd00fdbf56';
const read = p => execFileSync('git', ['-C', repository, 'show', `${baseline}:${p}`], {encoding:'utf8'});
const rules = read('packages/llm/src/local-rules.ts');
const packs = read('packages/speech-quality/src/domain-lexicon-packs.ts');
const tests = read('packages/llm/src/local-rules.test.ts');
const load = code => import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(code)).toString('base64'));
const module = await load(rules + '\nexport {termReplacements};');
const domains = await load(packs);
const conditions = [...new Set([...rules.matchAll(/has\("([^\"]+)"\)/g)].map(m => m[1]))];
const key = r => `${r[0].source}|${r[0].flags}|${r[1]}|${r[2]}`;
const all = module.termReplacements(conditions);
const replacements = all.map(r => ({pattern:r[0].source, insensitive:r[0].ignoreCase,
  replacement:r[1], operation:r[2], requires:conditions.filter(term =>
    !module.termReplacements(conditions.filter(t => t !== term)).some(other => key(other) === key(r)))}));
const ast = ts.createSourceFile('local-rules.ts', rules, ts.ScriptTarget.Latest, true);
function cleanRules(name) {
  const declaration = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  const out = [];
  function walk(node) {
    ts.forEachChild(node, walk);
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression) ||
        node.expression.name.text !== 'replace') return;
    assert(ts.isRegularExpressionLiteral(node.arguments[0]));
    assert(ts.isStringLiteral(node.arguments[1]));
    const regex = Function('return ' + node.arguments[0].text)();
    out.push({pattern:regex.source, insensitive:regex.ignoreCase, replacement:node.arguments[1].text});
  }
  walk(declaration); return out;
}
const defaults = module.defaultAsrProtectedTerms();
const visible = ['product','business','technology','medical','travel','dining','entertainment'];
const hiddenTerms = new Set(domains.domainTermPacks.cultivation.flat());
const domainTerms = Object.fromEntries(visible.map(p => [p, [...new Set([
  ...(p === 'product' ? defaults.filter(t => !hiddenTerms.has(t)) : []),
  ...domains.domainTermPacks[p].flat()])]]));
const vectors = [];
const testAst = ts.createSourceFile('local-rules.test.ts', tests, ts.ScriptTarget.Latest, true);
function scan(node) {
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'applyAsrLocalRules') {
    assert(ts.isStringLiteral(node.arguments[0]));
    const raw = node.arguments[0].text;
    const terms = node.arguments[1] ? node.arguments[1].elements.map(n => {assert(ts.isStringLiteral(n));return n.text;}) : null;
    vectors.push({raw, terms, expected:module.applyAsrLocalRules(raw, terms ?? undefined)});
  }
  ts.forEachChild(node, scan);
}
scan(testAst);
const dartString = s => JSON.stringify(s).replaceAll('$', '\\$');
const list = values => '[' + values.map(dartString).join(', ') + ']';
const tuple = r => `(${dartString(r.pattern)}, ${dartString(r.replacement)}, ${r.insensitive})`;
const header = `// Generated from frozen v1.0 ${baseline}; no new correction rules.\n`;
const data = header + 'const defaultAsrProtectedTerms = <String>' + list(defaults) + ';\n' +
  'const asrTermRules = <(String, String, bool, String, List<String>)>[\n' +
  replacements.map(r => `  (${dartString(r.pattern)}, ${dartString(r.replacement)}, ${r.insensitive}, ${dartString(r.operation)}, ${list(r.requires)}),`).join('\n') + '\n];\n' +
  'const asrSilenceRules = <(String, String, bool)>[' + cleanRules('cleanSilenceMarkers').map(tuple).join(',\n') + '];\n' +
  'const asrDisfluencyRules = <(String, String, bool)>[' + cleanRules('cleanDisfluencies').map(tuple).join(',\n') + '];\n';
const domainData = header + '// Hidden cultivation rules are retained in the rule library but are not activated by visible phone profiles.\n' +
  'const asrDomainProtectedTerms = <String, List<String>>{\n' + Object.entries(domainTerms).map(([p,terms]) => `  ${dartString(p)}: ${list(terms)},`).join('\n') + '\n};\n';
console.log(JSON.stringify({files:{
  'apps/mobile/lib/src/features/realtime/presentation/controllers/asr_local_rule_data.dart':data,
  'apps/mobile/lib/src/features/realtime/presentation/controllers/asr_local_domain_terms.dart':domainData,
  'apps/mobile/test/fixtures/v10_asr_local_rules.json':JSON.stringify({baseline,sourceSha256:createHash('sha256').update(rules).digest('hex'),vectors},null,2)+'\n'
},ruleCount:replacements.length,vectors:vectors.length}));
