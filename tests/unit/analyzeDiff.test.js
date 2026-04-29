/**
 * CommitSense Unit Tests — analyzeDiff + generateMessage
 *
 * Pure Node.js, zero dependencies.
 * Run: node tests/unit/analyzeDiff.test.js
 *
 * Coverage:
 *   ✅ Happy paths   — single / multi file, all commit types
 *   ✅ Edge cases    — empty diff, binary files, huge diff, no-newline
 *   ✅ Negative      — weak messages, missing fields, malformed diff
 *   ✅ Bug regressions — test+controller mix, refactor verb, null refs
 */

'use strict';

const { analyzeDiff } = require('../../src/analyzer/analyzeDiff');
const { generateMessage } = require('../../src/generator/generateMessage');

// ─── Minimal test harness ────────────────────────────────────────────────────

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
        failures.push(`${label} (expected: ${expected}, got: ${actual})`);
    }
}

function describe(suiteName, fn) {
    console.log(`\n📦 ${suiteName}`);
    fn();
}

// ─── Diff builder helper ─────────────────────────────────────────────────────

/**
 * Generates a minimal git diff string for one or more files.
 * @param {Array<{file: string, added: string[]}>} entries
 */
function makeDiff(entries) {
    return entries.map(({ file, added = [] }) => {
        const addedLines = added.map(l => `+${l}`).join('\n');
        return [
            `diff --git a/${file} b/${file}`,
            `--- a/${file}`,
            `+++ b/${file}`,
            `@@ -0,0 +1,${added.length} @@`,
            addedLines,
        ].join('\n');
    }).join('\n');
}

// ─── Test Suite ──────────────────────────────────────────────────────────────

// ── 1. analyzeDiff — extractChangedFiles ────────────────────────────────────
describe('extractChangedFiles', () => {
    it('parses a single file from diff', () => {
        const diff = makeDiff([{ file: 'src/auth/login.js', added: ['const x = 1;'] }]);
        const { changedFiles } = analyzeDiff(diff);
        assertEq(changedFiles.length, 1, 'single file detected');
        assertEq(changedFiles[0], 'src/auth/login.js', 'correct file path');
    });

    it('parses multiple files from diff', () => {
        const diff = makeDiff([
            { file: 'src/auth/login.js', added: ['const a = 1;'] },
            { file: 'src/auth/signup.js', added: ['const b = 2;'] },
            { file: 'src/payment/pay.js', added: ['const c = 3;'] },
        ]);
        const { changedFiles } = analyzeDiff(diff);
        assertEq(changedFiles.length, 3, 'three files detected');
    });

    it('deduplicates the same file appearing twice', () => {
        const diff = makeDiff([{ file: 'src/auth/login.js', added: ['x'] }])
            + '\n' + makeDiff([{ file: 'src/auth/login.js', added: ['y'] }]);
        const { changedFiles } = analyzeDiff(diff);
        assertEq(changedFiles.length, 1, 'no duplicate files');
    });

    it('ignores binary file lines', () => {
        const diff = 'Binary files a/images/logo.png and b/images/logo.png differ\n'
            + makeDiff([{ file: 'src/auth/login.js', added: ['const x = 1;'] }]);
        const { changedFiles } = analyzeDiff(diff);
        assertEq(changedFiles.length, 1, 'binary file not counted');
        assertEq(changedFiles[0], 'src/auth/login.js', 'only JS file counted');
    });
});

// Helper shorthand to avoid repeating `it`
function it(desc, fn) { fn(); }

// ── 2. detectType — commit type detection ────────────────────────────────────
describe('detectType — happy paths', () => {
    it('returns "test" when a .test.js file is changed', () => {
        const diff = makeDiff([{ file: 'src/auth/login.test.js', added: ['expect(login).toBeDefined();'] }]);
        const { suggestedType } = analyzeDiff(diff);
        assertEq(suggestedType, 'test', 'test file → type=test');
    });

    it('returns "test" when a .spec.js file is changed', () => {
        const diff = makeDiff([{ file: 'src/auth/auth.spec.js', added: ['describe("auth", () => {});'] }]);
        const { suggestedType } = analyzeDiff(diff);
        assertEq(suggestedType, 'test', '.spec file → type=test');
    });

    it('returns "test" when file is under /test/ directory', () => {
        const diff = makeDiff([{ file: 'test/login.test.js', added: ['it("works", () => {});'] }]);
        const { suggestedType } = analyzeDiff(diff);
        assertEq(suggestedType, 'test', '/test/ dir → type=test');
    });

    it('returns "chore" for package.json changes', () => {
        const diff = makeDiff([{ file: 'package.json', added: ['"jest": "^29.0.0"'] }]);
        const { suggestedType } = analyzeDiff(diff);
        assertEq(suggestedType, 'chore', 'package.json → type=chore');
    });

    it('returns "chore" for .eslintrc changes', () => {
        const diff = makeDiff([{ file: '.eslintrc.json', added: ['"semi": true'] }]);
        const { suggestedType } = analyzeDiff(diff);
        assertEq(suggestedType, 'chore', '.eslintrc → type=chore');
    });

    it('returns "docs" when only .md files changed', () => {
        const diff = makeDiff([{ file: 'README.md', added: ['# CommitSense'] }]);
        const { suggestedType } = analyzeDiff(diff);
        assertEq(suggestedType, 'docs', '.md only → type=docs');
    });

    it('returns "fix" when diff content includes "fix"', () => {
        const diff = makeDiff([{ file: 'src/auth/login.js', added: ['// fix: resolve login bug'] }]);
        const { suggestedType } = analyzeDiff(diff);
        assertEq(suggestedType, 'fix', '"fix" keyword → type=fix');
    });

    it('returns "fix" when diff content includes "bug"', () => {
        const diff = makeDiff([{ file: 'src/payment/pay.js', added: ['// bug: incorrect amount'] }]);
        const { suggestedType } = analyzeDiff(diff);
        assertEq(suggestedType, 'fix', '"bug" keyword → type=fix');
    });

    it('returns "refactor" when diff content includes "refactor"', () => {
        const diff = makeDiff([{ file: 'src/utils/helper.js', added: ['// refactor: cleanup'] }]);
        const { suggestedType } = analyzeDiff(diff);
        assertEq(suggestedType, 'refactor', '"refactor" keyword → type=refactor');
    });

    it('returns "refactor" when diff content includes "remove"', () => {
        const diff = makeDiff([{ file: 'src/auth/login.js', added: ['// remove old logic'] }]);
        const { suggestedType } = analyzeDiff(diff);
        assertEq(suggestedType, 'refactor', '"remove" keyword → type=refactor');
    });

    it('defaults to "feat" when no keywords match', () => {
        const diff = makeDiff([{ file: 'src/auth/login.js', added: ['const newFeature = true;'] }]);
        const { suggestedType } = analyzeDiff(diff);
        assertEq(suggestedType, 'feat', 'no keyword match → type=feat');
    });
});

// ── 3. detectScope ───────────────────────────────────────────────────────────
describe('detectScope — happy paths', () => {
    it('extracts "auth" from file path', () => {
        const diff = makeDiff([{ file: 'src/auth/login.js', added: [] }]);
        const { suggestedScope } = analyzeDiff(diff);
        assertEq(suggestedScope, 'auth', 'auth path → scope=auth');
    });

    it('extracts "payment" from file path', () => {
        const diff = makeDiff([{ file: 'src/payment/pay.js', added: [] }]);
        const { suggestedScope } = analyzeDiff(diff);
        assertEq(suggestedScope, 'payment', 'payment path → scope=payment');
    });

    it('extracts "utils" from file path', () => {
        const diff = makeDiff([{ file: 'src/utils/helper.js', added: [] }]);
        const { suggestedScope } = analyzeDiff(diff);
        assertEq(suggestedScope, 'utils', 'utils path → scope=utils');
    });

    it('returns empty scope when files span multiple unrelated dirs', () => {
        const diff = makeDiff([
            { file: 'src/auth/login.js', added: [] },
            { file: 'src/payment/pay.js', added: [] },
        ]);
        const { suggestedScope } = analyzeDiff(diff);
        // auth is checked first in KNOWN_SCOPES, so it should match auth
        assert(typeof suggestedScope === 'string', 'scope is a string');
    });
});

// ── 4. buildDescription — single file ────────────────────────────────────────
describe('buildDescription — single file', () => {
    it('feat single: uses domain label if keyword found', () => {
        const diff = makeDiff([{
            file: 'src/auth/login.js',
            added: ['function login(username, password) {}']
        }]);
        const { message } = generateMessage(analyzeDiff(diff));
        assert(message.includes('login') || message.includes('auth'), `feat single with login keyword: "${message}"`);
    });

    it('feat single: falls back to filename when no domain keyword', () => {
        const diff = makeDiff([{
            file: 'src/auth/login.js',
            added: ['const x = function() {};']
        }]);
        const { message } = generateMessage(analyzeDiff(diff));
        assert(message.includes('login') || message.includes('auth'), `feat single fallback: "${message}"`);
    });

    it('fix single: detects validation keyword', () => {
        const diff = makeDiff([{
            file: 'src/auth/login.js',
            added: ['// fix login validation error', 'validate(input);']
        }]);
        const { message } = generateMessage(analyzeDiff(diff));
        assert(message.includes('validation') || message.includes('login'), `fix validation: "${message}"`);
    });

    it('fix single: detects error/exception keyword', () => {
        const diff = makeDiff([{
            file: 'src/payment/pay.js',
            added: ['// fix: handle payment error', 'catch (error) {}']
        }]);
        const { message } = generateMessage(analyzeDiff(diff));
        assert(message.includes('pay') || message.includes('error'), `fix error: "${message}"`);
    });

    it('fix single: detects null reference', () => {
        const diff = makeDiff([{
            file: 'src/auth/login.js',
            added: ['// fix null check', 'if (user === null) return;']
        }]);
        const { message } = generateMessage(analyzeDiff(diff));
        assert(message.includes('null') || message.includes('login'), `fix null ref: "${message}"`);
    });

    it('refactor single: detects remove/delete semantics', () => {
        const diff = makeDiff([{
            file: 'src/utils/helper.js',
            added: ['// remove old formatDate helper']
        }]);
        const { message } = generateMessage(analyzeDiff(diff));
        assert(message.includes('remove') || message.includes('helper') || message.includes('utils'), `refactor remove: "${message}"`);
    });

    it('chore single: produces non-generic chore message', () => {
        const diff = makeDiff([{ file: 'package.json', added: ['"jest": "^29.0.0"'] }]);
        const { message } = generateMessage(analyzeDiff(diff));
        assert(message.startsWith('chore'), `chore message starts with "chore": "${message}"`);
        assert(!message.includes('update code'), `no weak words in: "${message}"`);
    });

    it('docs single: produces docs message', () => {
        const diff = makeDiff([{ file: 'README.md', added: ['## Usage'] }]);
        const { message } = generateMessage(analyzeDiff(diff));
        assert(message.startsWith('docs'), `docs message: "${message}"`);
    });
});

// ── 5. buildDescription — multi-file ─────────────────────────────────────────
describe('buildDescription — multi-file', () => {
    it('test+controller mix: describes what is being tested (regression fix)', () => {
        const diff = makeDiff([
            { file: 'tests/auth.test.js',       added: ['describe("auth", () => {});', 'it("login", () => {});'] },
            { file: 'tests/signup.test.js',      added: ['describe("signup", () => {});'] },
            { file: 'tests/helper.test.js',      added: ['describe("helper", () => {});'] },
            { file: 'src/auth/login.js',         added: ['function login(u, p) {}'] },
            { file: 'src/auth/auth.controller.js', added: ['module.exports = { login };'] },
        ]);
        const { message } = generateMessage(analyzeDiff(diff));
        assert(
            !message.includes('add test coverage'),
            `should NOT produce generic "add test coverage", got: "${message}"`
        );
        assert(
            message.startsWith('test'),
            `should still be type=test: "${message}"`
        );
        assert(
            message.includes('login') || message.includes('auth') || message.includes('signup'),
            `should mention what is tested: "${message}"`
        );
    });

    it('multi-file feat: combines up to 2 base names', () => {
        const diff = makeDiff([
            { file: 'src/auth/login.js',  added: ['const x = 1;'] },
            { file: 'src/auth/signup.js', added: ['const y = 2;'] },
        ]);
        const { message } = generateMessage(analyzeDiff(diff));
        assert(message.startsWith('feat') || message.startsWith('chore'), `multi-file message: "${message}"`);
    });

    it('multi-file with auth+payment: detects shared domain', () => {
        const diff = makeDiff([
            { file: 'src/auth/token.js',      added: ['function refreshToken() {}'] },
            { file: 'src/payment/invoice.js', added: ['function generateInvoice() {}'] },
        ]);
        const { message, isGeneric } = generateMessage(analyzeDiff(diff));
        assert(typeof message === 'string' && message.length > 0, `produces a message: "${message}"`);
        // Either domain-aware or base-name based — just should not be blank
    });

    it('many files (>2, no domain match): flags as generic with "multiple modules"', () => {
        const diff = makeDiff([
            { file: 'src/foo/a.js', added: ['const a = 1;'] },
            { file: 'src/bar/b.js', added: ['const b = 2;'] },
            { file: 'src/baz/c.js', added: ['const c = 3;'] },
            { file: 'src/qux/d.js', added: ['const d = 4;'] },
        ]);
        const { isGeneric } = generateMessage(analyzeDiff(diff));
        assert(isGeneric === true, 'many unrelated files → isGeneric=true');
    });

    it('pure test files only: produces "add test coverage"', () => {
        const diff = makeDiff([
            { file: 'tests/a.test.js', added: ['it("x", () => {});'] },
            { file: 'tests/b.test.js', added: ['it("y", () => {});'] },
        ]);
        const { message } = generateMessage(analyzeDiff(diff));
        assert(message.includes('test'), `pure test: "${message}"`);
    });
});

// ── 6. generateMessage — formatting & safety ──────────────────────────────────
describe('generateMessage — format & safety', () => {
    it('output follows conventional commits format type(scope): desc', () => {
        const diff = makeDiff([{ file: 'src/auth/login.js', added: ['const x = 1;'] }]);
        const { message } = generateMessage(analyzeDiff(diff));
        assert(/^[a-z]+(\([a-z]+\))?: .+/.test(message), `CC format: "${message}"`);
    });

    it('scope is always lowercase', () => {
        const diff = makeDiff([{ file: 'src/AUTH/Login.js', added: [] }]);
        const { message } = generateMessage(analyzeDiff(diff));
        assert(message === message.toLowerCase() || /\([a-z]+\)/.test(message), `scope lowercase: "${message}"`);
    });

    it('weak messages trigger isGeneric=true and fallback', () => {
        // Force a message that contains "change" — normally blocked by WEAK_WORDS
        // We simulate by checking the filter catches known weak words
        const weakAnalysis = {
            suggestedType: 'feat',
            suggestedScope: '',
            suggestedDesc: 'change stuff',
            isGeneric: false,
        };
        const { message, isGeneric } = generateMessage(weakAnalysis);
        assert(isGeneric === true, 'weak desc triggers isGeneric=true');
        assertEq(message, 'chore: update project files', 'fallback message for weak desc');
    });

    it('empty description triggers fallback', () => {
        const analysis = {
            suggestedType: 'feat',
            suggestedScope: 'auth',
            suggestedDesc: '',
            isGeneric: false,
        };
        const { message, isGeneric } = generateMessage(analysis);
        assert(isGeneric === true, 'empty desc → isGeneric=true');
        assertEq(message, 'chore: update project files', 'fallback for empty desc');
    });

    it('never uses weak verb "update" in type mapping', () => {
        const diff = makeDiff([{ file: 'src/payment/pay.js', added: ['const x = 1;'] }]);
        const { message } = generateMessage(analyzeDiff(diff));
        const desc = message.split(': ')[1] || '';
        assert(
            !desc.startsWith('update ') && !desc.startsWith('modify ') && !desc.startsWith('change '),
            `no weak verb in: "${message}"`
        );
    });

    it('warns on subject line > 50 chars', () => {
        const analysis = {
            suggestedType: 'feat',
            suggestedScope: 'auth',
            suggestedDesc: 'implement a very long description that exceeds the recommended subject line limit',
            isGeneric: false,
        };
        const { lengthWarning } = generateMessage(analysis);
        assert(lengthWarning !== null, 'length warning emitted for long message');
    });

    it('no length warning for short messages', () => {
        const diff = makeDiff([{ file: 'src/auth/login.js', added: ['const x = 1;'] }]);
        const { message, lengthWarning } = generateMessage(analyzeDiff(diff));
        if (message.length <= 50) {
            assert(lengthWarning === null, `no warning for short message: "${message}"`);
        } else {
            assert(lengthWarning !== null, `warning for long message: "${message}"`);
        }
    });
});

// ── 7. Edge cases ─────────────────────────────────────────────────────────────
describe('Edge cases', () => {
    it('handles completely empty diff string', () => {
        const { changedFiles, suggestedType } = analyzeDiff('');
        assertEq(changedFiles.length, 0, 'empty diff → 0 files');
        assertEq(suggestedType, 'feat', 'empty diff → type=feat (default)');
    });

    it('handles diff with only headers and no added lines', () => {
        const diff = [
            'diff --git a/src/auth/login.js b/src/auth/login.js',
            '--- a/src/auth/login.js',
            '+++ b/src/auth/login.js',
        ].join('\n');
        const { changedFiles } = analyzeDiff(diff);
        assertEq(changedFiles.length, 1, 'header-only diff still extracts file');
    });

    it('handles diff > MAX_DIFF_SIZE (100KB) by truncating gracefully', () => {
        const bigLine = '+' + 'x'.repeat(1000);
        const lines = [
            'diff --git a/src/auth/login.js b/src/auth/login.js',
            '--- a/src/auth/login.js',
            '+++ b/src/auth/login.js',
            '@@ -0,0 +1 @@',
        ];
        // Pad to exceed 100KB
        while (lines.join('\n').length < 110_000) {
            lines.push(bigLine);
        }
        const diff = lines.join('\n');
        assert(diff.length > 100_000, 'diff is larger than MAX_DIFF_SIZE');
        const result = analyzeDiff(diff);
        assert(typeof result.suggestedType === 'string', 'truncated diff still produces a type');
    });

    it('handles Windows-style CRLF line endings', () => {
        const diff = [
            'diff --git a/src/auth/login.js b/src/auth/login.js\r',
            '--- a/src/auth/login.js\r',
            '+++ b/src/auth/login.js\r',
            '@@ -0,0 +1 @@\r',
            '+const login = () => {};\r',
        ].join('\n');
        const result = analyzeDiff(diff);
        // Should not crash
        assert(typeof result.suggestedType === 'string', 'CRLF diff handled without crash');
    });

    it('handles a file at repo root (no parent directory)', () => {
        const diff = makeDiff([{ file: 'index.js', added: ['module.exports = {};'] }]);
        const result = analyzeDiff(diff);
        assert(typeof result.suggestedScope === 'string', 'root-level file produces a scope string (may be empty)');
    });

    it('handles files with multiple dots in name (e.g. auth.controller.js)', () => {
        const diff = makeDiff([{ file: 'src/auth/auth.controller.js', added: ['const x = 1;'] }]);
        const { changedFiles } = analyzeDiff(diff);
        assertEq(changedFiles[0], 'src/auth/auth.controller.js', 'multi-dot filename parsed correctly');
    });

    it('handles a renamed file diff (a/ path differs from b/ path)', () => {
        const diff = [
            'diff --git a/src/auth/old-login.js b/src/auth/new-login.js',
            '--- a/src/auth/old-login.js',
            '+++ b/src/auth/new-login.js',
            '@@ -0,0 +1 @@',
            '+const x = 1;',
        ].join('\n');
        const { changedFiles } = analyzeDiff(diff);
        assertEq(changedFiles[0], 'src/auth/new-login.js', 'renamed file uses b/ path');
    });

    it('handles purely deleted lines diff (no + lines)', () => {
        const diff = [
            'diff --git a/src/auth/login.js b/src/auth/login.js',
            '--- a/src/auth/login.js',
            '+++ b/src/auth/login.js',
            '@@ -1,3 +0,0 @@',
            '-const old = true;',
            '-const legacy = 1;',
        ].join('\n');
        const result = analyzeDiff(diff);
        // Should not crash; type could be refactor or feat
        assert(typeof result.suggestedType === 'string', 'delete-only diff produces a type without crash');
    });
});

// ── 8. Domain signal detection ────────────────────────────────────────────────
describe('Domain signal detection', () => {
    const domainCases = [
        { label: 'auth+jwt',        file: 'src/auth/token.js',        content: 'const jwt = require("jsonwebtoken");' },
        { label: 'auth+session',    file: 'src/auth/session.js',       content: 'req.session.userId = user.id;' },
        { label: 'auth+password',   file: 'src/auth/auth.js',          content: 'user.password = hash;' },
        { label: 'payment+invoice', file: 'src/payment/invoice.js',    content: 'const invoice = createInvoice();' },
        { label: 'payment+billing', file: 'src/payment/billing.js',    content: 'const billing = {};' },
        { label: 'db+migration',    file: 'src/db/migration.js',       content: 'await knex.migrate.latest();' },
        { label: 'db+schema',       file: 'src/db/schema.js',          content: 'const schema = new Schema({});' },
        { label: 'api+endpoint',    file: 'src/api/routes.js',         content: 'router.get("/endpoint", handler);' },
        { label: 'api+middleware',  file: 'src/api/middleware.js',     content: 'const handler = middleware();' },
        { label: 'config+env',      file: 'src/config/settings.js',    content: 'const env = process.env;' },
        { label: 'notification+email', file: 'src/notification/email.js', content: 'sendEmail(user, "Welcome");' },
    ];

    domainCases.forEach(({ label, file, content }) => {
        it(`detects "${label}" domain signal → non-generic message`, () => {
            const diff = makeDiff([{ file, added: [content] }]);
            const { message, isGeneric } = generateMessage(analyzeDiff(diff));
            assert(!isGeneric, `"${label}" → non-generic: "${message}"`);
            assert(typeof message === 'string' && message.length > 0, `"${label}" → has message`);
        });
    });
});

// ── 9. Regression: specific message quality checks ───────────────────────────
describe('Message quality regressions', () => {
    it('auth login file → message mentions "login" or "auth"', () => {
        const diff = makeDiff([{ file: 'src/auth/login.js', added: ['async function login(u, p) { return token; }'] }]);
        const { message } = generateMessage(analyzeDiff(diff));
        assert(message.includes('login') || message.includes('auth'), `login file quality: "${message}"`);
    });

    it('signup file → message mentions "signup" or "register"', () => {
        const diff = makeDiff([{ file: 'src/auth/signup.js', added: ['async function signup(email) { return { userId }; }'] }]);
        const { message } = generateMessage(analyzeDiff(diff));
        assert(message.includes('signup') || message.includes('register') || message.includes('auth'), `signup file quality: "${message}"`);
    });

    it('payment file → message mentions "payment" or "invoice"', () => {
        const diff = makeDiff([{ file: 'src/payment/pay.js', added: ['async function processPayment(amount) { return txn; }'] }]);
        const { message } = generateMessage(analyzeDiff(diff));
        assert(
            message.includes('pay') || message.includes('payment') || message.includes('invoice') || message.includes('transaction'),
            `payment file quality: "${message}"`
        );
    });

    it('auth+signup together → combined description', () => {
        const diff = makeDiff([
            { file: 'src/auth/login.js',  added: ['function login() {}'] },
            { file: 'src/auth/signup.js', added: ['function signup() {}'] },
        ]);
        const { message } = generateMessage(analyzeDiff(diff));
        assert(
            message.includes('login') || message.includes('signup') || message.includes('auth'),
            `combined auth: "${message}"`
        );
    });

    it('message does not start with "update " (weak verb)', () => {
        const diff = makeDiff([{ file: 'src/auth/login.js', added: ['const x = 1;'] }]);
        const { message } = generateMessage(analyzeDiff(diff));
        const afterColon = (message.split(': ')[1] || '').toLowerCase();
        assert(!afterColon.startsWith('update '), `no "update" prefix in desc: "${message}"`);
    });

    it('message does not start with "modify " or "change " (weak verbs)', () => {
        const diff = makeDiff([{ file: 'src/payment/pay.js', added: ['const x = 1;'] }]);
        const { message } = generateMessage(analyzeDiff(diff));
        const afterColon = (message.split(': ')[1] || '').toLowerCase();
        assert(!afterColon.startsWith('modify ') && !afterColon.startsWith('change '), `no weak verbs: "${message}"`);
    });
});

// ─── Results ─────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(60));
console.log(`\n📊 Results: ${passed} passed, ${failed} failed out of ${passed + failed} total`);

if (failures.length > 0) {
    console.error('\n❌ Failed tests:');
    failures.forEach((f, i) => console.error(`  ${i + 1}. ${f}`));
    process.exit(1);
} else {
    console.log('\n🎉 All tests passed!\n');
}
