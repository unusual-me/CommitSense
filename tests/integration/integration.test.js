#!/usr/bin/env node
/**
 * CommitSense Integration Tests — Full pipeline via test-repo
 *
 * Uses the real test-repo git repository to produce actual `git diff` output
 * and validates the end-to-end flow: getStagedDiff → analyzeDiff → generateMessage.
 *
 * Run: node tests/integration/integration.test.js
 *
 * Prerequisites: test-repo must be a valid git repo (it already has .git/).
 */

'use strict';

const path           = require('path');
const fs             = require('fs');
const { execFileSync } = require('child_process');
const { getStagedDiff, getUnstagedDiff } = require('../../src/git/getDiff');
const { analyzeDiff }    = require('../../src/analyzer/analyzeDiff');
const { generateMessage } = require('../../src/generator/generateMessage');

const REPO = path.resolve(__dirname, '../../test-repo');

// ─── Harness ─────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, label) {
    if (condition) {
        console.log(`  ✅ ${label}`);
        passed++;
    } else {
        console.error(`  ❌ FAIL: ${label}`);
        failed++;
        failures.push(label);
    }
}

function assertEq(actual, expected, label) {
    if (actual === expected) {
        console.log(`  ✅ ${label}`);
        passed++;
    } else {
        console.error(`  ❌ FAIL: ${label}`);
        console.error(`       expected: ${JSON.stringify(expected)}`);
        console.error(`       received: ${JSON.stringify(actual)}`);
        failed++;
        failures.push(`${label} (expected=${expected}, got=${actual})`);
    }
}

// ─── Git helpers ─────────────────────────────────────────────────────────────

function git(...args) {
    return execFileSync('git', args, { cwd: REPO, stdio: 'pipe' }).toString().trim();
}

function cleanRepo() {
    try { git('checkout', '.'); }          catch (_) {}
    try { git('clean', '-fd'); }           catch (_) {}
    try { git('restore', '--staged', '.'); } catch (_) {}
}

function writeRepo(relPath, content) {
    const abs = path.join(REPO, relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
}

function appendRepo(relPath, extra) {
    const abs = path.join(REPO, relPath);
    const existing = fs.readFileSync(abs, 'utf8');
    fs.writeFileSync(abs, existing + extra, 'utf8');
}

function stage(relPath) { git('add', relPath); }
function stageAll()     { git('add', '-A'); }

// ─── Ensure git identity ──────────────────────────────────────────────────────
try {
    git('config', 'user.email', 'test@commitsense.local');
    git('config', 'user.name',  'CommitSense Test');
} catch (_) {}

// ─── Sequential test runner ───────────────────────────────────────────────────

const suites = [];

/**
 * Registers a named test suite. fn must return a Promise.
 */
function suite(name, fn) {
    suites.push({ name, fn });
}

async function runAll() {
    for (const { name, fn } of suites) {
        console.log(`\n📦 ${name}`);
        cleanRepo();
        try {
            await fn();
        } catch (err) {
            console.error(`  ❌ SUITE ERROR: ${err.message}`);
            failed++;
            failures.push(`${name} (threw: ${err.message})`);
        } finally {
            cleanRepo();
        }
    }

    console.log('\n' + '─'.repeat(60));
    console.log(`\n📊 Results: ${passed} passed, ${failed} failed out of ${passed + failed} total`);
    if (failures.length > 0) {
        console.error('\n❌ Failed scenarios:');
        failures.forEach((f, i) => console.error(`  ${i + 1}. ${f}`));
        process.exit(1);
    } else {
        console.log('\n🎉 All integration tests passed!\n');
    }
}

// ─── Helper: run a staged-diff scenario ──────────────────────────────────────
async function stagedScenario(setup, assertions) {
    setup();
    const rawDiff = await getStagedDiff(REPO);
    const analysis = analyzeDiff(rawDiff);
    const { message, isGeneric, lengthWarning } = generateMessage(analysis);
    await assertions({ rawDiff, analysis, message, isGeneric, lengthWarning });
}

// ═════════════════════════════════════════════════════════════════════════════
// SCENARIOS
// ═════════════════════════════════════════════════════════════════════════════

// ── SC1: Single auth file ─────────────────────────────────────────────────────
suite('SC1: Single auth file staged', async () => {
    await stagedScenario(
        () => {
            writeRepo('src/auth/login.js', [
                'async function login(username, password) {',
                '    if (!username || !password) throw new Error("Credentials required");',
                '    const token = generateToken(username);',
                '    return { token };',
                '}',
                'module.exports = { login };',
            ].join('\n'));
            stage('src/auth/login.js');
        },
        ({ message, analysis, isGeneric }) => {
            assert(!isGeneric, `non-generic: "${message}"`);
            assertEq(analysis.suggestedScope, 'auth', 'scope=auth');
            assert(message.includes('login') || message.includes('auth'), `mentions auth/login: "${message}"`);
            assert(!message.split(': ')[1]?.startsWith('update '), `no weak verb: "${message}"`);
        }
    );
});

// ── SC2: Single payment file ──────────────────────────────────────────────────
suite('SC2: Single payment file staged', async () => {
    await stagedScenario(
        () => {
            writeRepo('src/payment/pay.js', [
                'async function processPayment(amount, currency) {',
                '    if (amount <= 0) throw new Error("Invalid amount");',
                '    const invoice = generateInvoice(amount, currency);',
                '    return { transactionId: invoice.id, status: "success" };',
                '}',
                'module.exports = { processPayment };',
            ].join('\n'));
            stage('src/payment/pay.js');
        },
        ({ message, analysis, isGeneric }) => {
            assert(!isGeneric, `non-generic: "${message}"`);
            assertEq(analysis.suggestedScope, 'payment', 'scope=payment');
            assert(
                message.includes('pay') || message.includes('invoice') || message.includes('transaction'),
                `mentions payment domain: "${message}"`
            );
        }
    );
});

// ── SC3: Multi-file same scope (auth) ─────────────────────────────────────────
suite('SC3: Multi-file same scope (auth/login + auth/signup)', async () => {
    await stagedScenario(
        () => {
            writeRepo('src/auth/login.js',  `async function login(u, p) { return { token: 'jwt-token' }; }\nmodule.exports = { login };`);
            writeRepo('src/auth/signup.js', `async function signup(email, pw) { return { userId: 'user-001' }; }\nmodule.exports = { signup };`);
            stage('src/auth/login.js');
            stage('src/auth/signup.js');
        },
        ({ message, analysis, isGeneric }) => {
            assert(!isGeneric, `non-generic: "${message}"`);
            assertEq(analysis.suggestedScope, 'auth', 'scope=auth');
            assert(
                message.includes('login') || message.includes('signup') || message.includes('auth'),
                `combined auth message: "${message}"`
            );
        }
    );
});

// ── SC4: Test + controller regression ────────────────────────────────────────
suite('SC4: Test + controller files staged (regression — must not be generic)', async () => {
    await stagedScenario(
        () => {
            writeRepo('tests/auth.test.js',   `describe('auth', () => {\n  it('login', () => expect(login).toBeDefined());\n  it('signup', () => expect(signup).toBeDefined());\n});\n`);
            writeRepo('tests/signup.test.js', `describe('signup', () => {\n  it('register', () => expect(signup).toBeDefined());\n});\n`);
            writeRepo('tests/helper.test.js', `describe('helper', () => { it('works', () => {}); });\n`);
            writeRepo('src/auth/login.js',    `function login(u, p) { return { token: 'jwt' }; }\nmodule.exports = { login };\n`);
            writeRepo('src/auth/auth.controller.js', `module.exports = { login: require('./login').login };\n`);
            stageAll();
        },
        ({ message, analysis }) => {
            assertEq(analysis.suggestedType, 'test', 'type=test');
            assert(
                !message.includes('add test coverage'),
                `must NOT be generic "add test coverage": "${message}"`
            );
            assert(
                message.includes('auth') || message.includes('login') || message.includes('signup'),
                `names what is tested: "${message}"`
            );
        }
    );
});

// ── SC5: Chore ────────────────────────────────────────────────────────────────
suite('SC5: Chore — package.json update', async () => {
    await stagedScenario(
        () => {
            const pkgPath = path.join(REPO, 'package.json');
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            pkg.devDependencies = { ...pkg.devDependencies, supertest: '^6.0.0' };
            fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
            stage('package.json');
        },
        ({ message, analysis }) => {
            assertEq(analysis.suggestedType, 'chore', 'type=chore');
            assert(message.startsWith('chore'), `starts with "chore": "${message}"`);
            assert(!message.includes('update code'), `no weak fallback: "${message}"`);
        }
    );
});

// ── SC6: Docs ─────────────────────────────────────────────────────────────────
suite('SC6: Docs — README.md update', async () => {
    await stagedScenario(
        () => {
            writeRepo('README.md', `# CommitSense Test Repo\n\n## Usage\n\nRun tests with npm test.\n`);
            stage('README.md');
        },
        ({ message, analysis }) => {
            assertEq(analysis.suggestedType, 'docs', 'type=docs');
            assert(message.startsWith('docs'), `starts with "docs": "${message}"`);
        }
    );
});

// ── SC7: Fix keyword in content ───────────────────────────────────────────────
suite('SC7: Fix keyword in diff content', async () => {
    await stagedScenario(
        () => {
            writeRepo('src/utils/helper.js', [
                '// fix: resolve incorrect date formatting',
                'function formatDate(date) {',
                '    if (!date) return null; // fix null reference',
                '    return new Date(date).toISOString();',
                '}',
                'function slugify(str) { return str.toLowerCase().replace(/\\s+/g, "-"); }',
                'module.exports = { formatDate, slugify };',
            ].join('\n'));
            stage('src/utils/helper.js');
        },
        ({ message, analysis }) => {
            assertEq(analysis.suggestedType, 'fix', 'type=fix');
            assert(message.startsWith('fix'), `starts with "fix": "${message}"`);
            assert(
                message.includes('null') || message.includes('helper') || message.includes('utils'),
                `specific fix description: "${message}"`
            );
        }
    );
});

// ── SC8: Refactor keyword in content ─────────────────────────────────────────
suite('SC8: Refactor keyword in diff content', async () => {
    await stagedScenario(
        () => {
            writeRepo('src/utils/helper.js', [
                '// refactor: cleanup and simplify formatDate',
                'function formatDate(d) { return new Date(d).toISOString(); }',
                'module.exports = { formatDate };',
            ].join('\n'));
            stage('src/utils/helper.js');
        },
        ({ message, analysis }) => {
            assertEq(analysis.suggestedType, 'refactor', 'type=refactor');
            assert(message.startsWith('refactor'), `starts with "refactor": "${message}"`);
        }
    );
});

// ── SC9: No staged changes → empty staged diff ────────────────────────────────
suite('SC9: No staged changes → getStagedDiff returns empty string', async () => {
    // cleanRepo() already called by runAll() before each suite
    const rawDiff = await getStagedDiff(REPO);
    assertEq(rawDiff, '', 'clean repo → empty staged diff');
});

// ── SC10: Unstaged changes → getUnstagedDiff ─────────────────────────────────
suite('SC10: Unstaged changes → getUnstagedDiff captures working-tree diff', async () => {
    // Append content to a tracked file WITHOUT staging
    appendRepo('src/auth/login.js', '\n// UNSTAGED CHANGE: added by SC10\nconst UNSTAGED = true;\n');

    const stagedDiff   = await getStagedDiff(REPO);
    const unstagedDiff = await getUnstagedDiff(REPO);

    assertEq(stagedDiff, '', 'unstaged file → staged diff is empty');
    assert(unstagedDiff.length > 0,          'getUnstagedDiff captures working-tree changes');
    assert(unstagedDiff.includes('login.js'), 'unstaged diff references login.js');

    const analysis = analyzeDiff(unstagedDiff);
    assert(analysis.changedFiles.length > 0, 'analyzeDiff works on unstaged diff');
    assertEq(analysis.suggestedScope, 'auth', 'unstaged diff → scope=auth');
});

// ── SC11: Multiple unrelated files → generic ──────────────────────────────────
suite('SC11: Multiple unrelated files → isGeneric=true', async () => {
    await stagedScenario(
        () => {
            writeRepo('src/foo/alpha.js',   'const alpha = 1;');
            writeRepo('src/bar/bravo.js',   'const bravo = 2;');
            writeRepo('src/baz/charlie.js', 'const charlie = 3;');
            writeRepo('src/qux/delta.js',   'const delta = 4;');
            stageAll();
        },
        ({ isGeneric, message }) => {
            assert(isGeneric === true, `many unrelated files → isGeneric=true: "${message}"`);
        }
    );
});

// ── SC12: Large diff gracefully truncated ─────────────────────────────────────
suite('SC12: Large diff is gracefully truncated', async () => {
    await stagedScenario(
        () => {
            const bigContent = Array.from({ length: 5000 }, (_, i) => `const line${i} = ${i};`).join('\n');
            writeRepo('src/auth/login.js', bigContent);
            stage('src/auth/login.js');
        },
        ({ message, analysis }) => {
            assert(typeof analysis.suggestedType === 'string', 'large diff → produces type');
            assert(typeof message === 'string' && message.length > 0, 'large diff → produces message');
        }
    );
});

// ── SC13: Delete-only diff (remove lines, no additions) ───────────────────────
suite('SC13: Delete-only diff (remove lines with no additions)', async () => {
    // First: add extra lines and stage+commit so git can see a deletion
    writeRepo('src/utils/helper.js', [
        'function formatDate(date) { return new Date(date).toISOString(); }',
        'const LEGACY = true; // to be deleted',
        'const OLD_FLAG = 1;  // to be deleted',
        'module.exports = { formatDate };',
    ].join('\n'));
    stageAll();
    try { git('commit', '-m', 'test: add files for SC13'); } catch (_) {}

    // Now remove the legacy lines
    writeRepo('src/utils/helper.js', [
        'function formatDate(date) { return new Date(date).toISOString(); }',
        'module.exports = { formatDate };',
    ].join('\n'));
    stageAll();

    const rawDiff = await getStagedDiff(REPO);
    const analysis = analyzeDiff(rawDiff);
    const { message } = generateMessage(analysis);

    assert(typeof analysis.suggestedType === 'string', `delete-only → produces type: "${analysis.suggestedType}"`);
    assert(typeof message === 'string' && message.length > 0, `delete-only → produces message: "${message}"`);

    // Undo the temporary commit
    try { git('reset', '--soft', 'HEAD~1'); } catch (_) {}
});

// ── SC14: Binary file in diff (ignored, other files still processed) ──────────
suite('SC14: Binary file alongside JS file — binary ignored', async () => {
    // Stage a real text file and simulate the presence of a binary entry in the diff
    writeRepo('src/auth/login.js', `function login(u, p) { return { token: 'v2' }; }\nmodule.exports = { login };\n`);
    stage('src/auth/login.js');

    const rawDiff = await getStagedDiff(REPO);
    // Prepend a fake binary line (analyzeDiff should skip it)
    const patchedDiff = 'Binary files a/images/logo.png and b/images/logo.png differ\n' + rawDiff;
    const { changedFiles } = analyzeDiff(patchedDiff);

    assert(!changedFiles.includes('images/logo.png'), 'binary file NOT in changedFiles');
    assert(changedFiles.includes('src/auth/login.js'), 'JS file IS in changedFiles');
});

// ── SC15: Validation fix in payment controller ────────────────────────────────
suite('SC15: Fix validation in payment controller', async () => {
    await stagedScenario(
        () => {
            writeRepo('src/payment/pay.js', [
                '// fix: validate payment amount before processing',
                'async function processPayment(amount, currency) {',
                '    if (!amount || amount <= 0) throw new Error("Invalid amount");',
                '    validate(currency); // validate currency code',
                '    return { transactionId: "txn-001", status: "success" };',
                '}',
                'module.exports = { processPayment };',
            ].join('\n'));
            stage('src/payment/pay.js');
        },
        ({ message, analysis }) => {
            assertEq(analysis.suggestedType, 'fix', 'type=fix');
            assert(
                message.includes('validation') || message.includes('pay') || message.includes('payment'),
                `specific validation fix: "${message}"`
            );
        }
    );
});

// ─── Run everything ───────────────────────────────────────────────────────────
runAll();
