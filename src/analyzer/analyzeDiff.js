/** @typedef {{ changedFiles: string[], suggestedType: string, suggestedScope: string, suggestedDesc: string, isGeneric: boolean }} DiffAnalysis */

// Max diff size (bytes) to prevent performance issues on huge repos
const MAX_DIFF_SIZE = 100_000;

// Known domain scopes to extract from path segments
const KNOWN_SCOPES = [
    'auth', 'user', 'users', 'payment', 'payments', 'wallet', 'transaction',
    'transactions', 'notification', 'api', 'db', 'database', 'ui', 'config',
    'admin', 'dashboard', 'cart', 'order', 'orders', 'report', 'search',
    'middleware', 'routes', 'models', 'services', 'controllers', 'utils'
];

// Chore file matchers
const CHORE_PATTERNS = [
    'package.json', 'package-lock.json', 'yarn.lock', '.npmrc',
    'webpack.config', '.eslintrc', '.prettierrc', '.babelrc',
    '.github/', 'Dockerfile', 'docker-compose', '.env', '.ignore',
    'tsconfig', 'jest.config', '.editorconfig', '.husky'
];

/**
 * Safely truncates the diff to avoid processing excessively large outputs.
 * @param {string} diff
 * @returns {string}
 */
function truncateDiff(diff) {
    if (diff.length > MAX_DIFF_SIZE) {
        return diff.slice(0, MAX_DIFF_SIZE);
    }
    return diff;
}

/**
 * Extracts all changed file paths from the raw diff output.
 * Ignores binary file lines.
 * @param {string[]} lines
 * @returns {string[]}
 */
function extractChangedFiles(lines) {
    const changedFiles = [];
    const diffRegex = /^diff --git a\/(.+?) b\/(.+?)$/;

    for (const line of lines) {
        // Skip binary file diffs
        if (line.startsWith('Binary files')) continue;

        if (line.startsWith('diff --git')) {
            const match = line.match(diffRegex);
            if (match && match[2] && !changedFiles.includes(match[2])) {
                changedFiles.push(match[2]);
            }
        }
    }
    return changedFiles;
}

/**
 * Detects the commit type based on file extensions and added diff lines.
 * Priority: test > chore > docs > fix > refactor > feat (default)
 *
 * Keyword domain signals (checked against added content):
 *   auth    → login, jwt, token, session, password, authenticate
 *   payment → invoice, billing, transaction, checkout, stripe, refund
 *   db      → schema, migration, query, sequelize, mongoose, knex
 *   api     → endpoint, route, controller, middleware, handler, swagger
 *   test    → spec, mock, stub, spy, expect, describe, it(
 *
 * @param {string[]} changedFiles
 * @param {string[]} addedLines
 * @returns {string}
 */
function detectType(changedFiles, addedLines) {
    const isTest = changedFiles.some(f =>
        f.includes('.test.') || f.includes('.spec.') || f.includes('__tests__') || f.includes('/test/')
    );
    if (isTest) return 'test';

    const isChore = changedFiles.some(f =>
        CHORE_PATTERNS.some(pattern => f.includes(pattern))
    );
    if (isChore) return 'chore';

    const isDocs = changedFiles.length > 0 && changedFiles.every(f => f.endsWith('.md') || f.endsWith('.txt') || f.endsWith('.rst'));
    if (isDocs) return 'docs';

    // Check content added in the diff
    const addedContent = addedLines.join(' ').toLowerCase();
    if (addedContent.includes('fix') || addedContent.includes('bug') || addedContent.includes('resolve') || addedContent.includes('patch')) {
        return 'fix';
    }
    if (addedContent.includes('refactor') || addedContent.includes('cleanup') || addedContent.includes('simplify') || addedContent.includes('reorganize')) {
        return 'refactor';
    }
    if (addedContent.includes('remove') || addedContent.includes('delete') || addedContent.includes('drop')) {
        return 'refactor';
    }

    return 'feat';
}

/**
 * Detects the scope from a list of changed file paths.
 * Strategy:
 * 1. Match well-known domain segment names.
 * 2. For a single file, use the immediate parent directory.
 * 3. For multi-file with one dominant parent dir (after src/), use that.
 * @param {string[]} changedFiles
 * @returns {string}
 */
function detectScope(changedFiles) {
    // Collect all path segments, normalized
    const allSegments = changedFiles
        .map(f => f.split('/'))
        .flat()
        .map(s => s.toLowerCase().replace(/\.[^.]+$/, '')); // strip extensions

    // Match against known scopes (exact or contains)
    for (const scope of KNOWN_SCOPES) {
        if (allSegments.some(seg => seg === scope || seg.includes(scope))) {
            return scope;
        }
    }

    // For a single file, climb up to the parent dir after 'src'
    if (changedFiles.length === 1) {
        const parts = changedFiles[0].split('/');
        const srcIdx = parts.indexOf('src');
        if (srcIdx !== -1 && parts.length > srcIdx + 2) {
            return parts[srcIdx + 1]; // first meaningful dir under src/
        }
        if (parts.length > 1) {
            return parts[parts.length - 2]; // fallback: immediate parent
        }
    }

    // For multiple files: find the common top-level directory (after src/)
    const topDirs = changedFiles.map(f => {
        const parts = f.split('/');
        const srcIdx = parts.indexOf('src');
        return srcIdx !== -1 && parts.length > srcIdx + 1
            ? parts[srcIdx + 1]
            : parts[0];
    });
    const unique = [...new Set(topDirs)];
    if (unique.length === 1) return unique[0]; // all files share one dir

    return ''; // no clear dominant scope — omit scope
}

/**
 * Domain keyword signals used to generate smarter multi-file descriptions.
 * Each entry maps a domain label to a list of content signals.
 */
const DOMAIN_SIGNALS = [
    { label: 'login',      keywords: ['login', 'signin', 'sign-in'] },
    { label: 'signup',     keywords: ['signup', 'register', 'registration', 'sign-up'] },
    { label: 'auth',       keywords: ['authentication', 'authenticate', 'jwt', 'token', 'session', 'password', 'oauth'] },
    { label: 'validation', keywords: ['validation', 'validate', 'validator', 'schema'] },
    { label: 'payment',    keywords: ['payment', 'invoice', 'billing', 'transaction', 'checkout', 'stripe', 'refund'] },
    { label: 'database',   keywords: ['migration', 'schema', 'query', 'sequelize', 'mongoose', 'knex', 'prisma'] },
    { label: 'api',        keywords: ['endpoint', 'route', 'controller', 'middleware', 'handler', 'swagger', 'rest'] },
    { label: 'tests',      keywords: ['spec', 'mock', 'stub', 'spy', 'expect', 'describe', 'it('] },
    { label: 'config',     keywords: ['config', 'env', 'settings', 'dotenv'] },
    { label: 'notification', keywords: ['notification', 'email', 'sms', 'push', 'alert'] },
];

/**
 * Finds matched domain labels from diff content and changed file paths.
 * @param {string} addedContent - Lowercased concatenation of added diff lines.
 * @param {string[]} changedFiles
 * @returns {string[]} Matched domain labels (up to 2 most specific)
 */
function detectDomainLabels(addedContent, changedFiles) {
    const fileStr = changedFiles.join(' ').toLowerCase();
    const combined = addedContent + ' ' + fileStr;
    const matches = [];
    for (const { label, keywords } of DOMAIN_SIGNALS) {
        if (keywords.some(kw => combined.includes(kw))) {
            matches.push(label);
        }
    }
    return matches.slice(0, 2); // keep at most 2 labels for readability
}

/**
 * Generates a human-readable description using strong action verbs.
 * Avoids weak verbs (change, modify, update) — uses add, implement, fix, refactor, remove.
 * @param {string} type
 * @param {string[]} changedFiles
 * @param {string[]} addedLines
 * @returns {{ desc: string, isGeneric: boolean }}
 */
function buildDescription(type, changedFiles, addedLines) {
    const VERB_MAP = {
        feat:     'implement',
        fix:      'resolve',
        refactor: 'refactor',
        chore:    'configure',
        test:     'add tests for',
        docs:     'update docs for',
    };

    const verb = VERB_MAP[type] || 'implement';
    const addedContent = addedLines.join(' ').toLowerCase();

    // Single file
    if (changedFiles.length === 1) {
        const parts = changedFiles[0].split('/');
        // Strip extension and use base name
        const baseName = parts[parts.length - 1].replace(/\.[^.]+$/, '');

        if (type === 'fix') {
            if (addedContent.includes('validation') || addedContent.includes('validate')) {
                return { desc: `resolve ${baseName} validation issue`, isGeneric: false };
            }
            if (addedContent.includes('error') || addedContent.includes('exception')) {
                return { desc: `handle ${baseName} error`, isGeneric: false };
            }
            if (addedContent.includes('null') || addedContent.includes('undefined')) {
                return { desc: `fix null reference in ${baseName}`, isGeneric: false };
            }
            return { desc: `resolve issue in ${baseName}`, isGeneric: false };
        }

        if (type === 'feat') {
            const labels = detectDomainLabels(addedContent, changedFiles);
            if (labels.length > 0) {
                return { desc: `add ${labels.join(' and ')}`, isGeneric: false };
            }
            if (addedContent.includes('class') || addedContent.includes('function') || addedContent.includes('const')) {
                return { desc: `implement ${baseName} logic`, isGeneric: false };
            }
            return { desc: `add ${baseName}`, isGeneric: false };
        }

        if (type === 'refactor') {
            if (addedContent.includes('remove') || addedContent.includes('delete') || addedContent.includes('drop')) {
                return { desc: `remove unused code in ${baseName}`, isGeneric: false };
            }
            return { desc: `refactor ${baseName}`, isGeneric: false };
        }

        return { desc: `${verb} ${baseName}`, isGeneric: false };
    }

    // Multiple files
    if (type === 'chore') {
        return { desc: 'update project configuration', isGeneric: false };
    }
    if (type === 'test') {
        // Try domain labels first (picks up 'auth', 'payment', etc from content + filenames)
        const labels = detectDomainLabels(addedContent, changedFiles);
        if (labels.length > 0) {
            return { desc: `add tests for ${labels.join(' and ')}`, isGeneric: false };
        }

        // Fall back to base names of non-test files (e.g. auth.controller, user.service)
        const nonTestFiles = changedFiles.filter(f =>
            !f.includes('.test.') && !f.includes('.spec.') &&
            !f.includes('__tests__') && !f.includes('/test/')
        );
        if (nonTestFiles.length > 0) {
            const nonTestNames = nonTestFiles
                .map(f => f.split('/').pop().replace(/\.[^.]+$/, ''))
                .filter((n, i, arr) => arr.indexOf(n) === i); // unique
            if (nonTestNames.length <= 2) {
                return { desc: `add tests for ${nonTestNames.join(' and ')}`, isGeneric: false };
            }
            return { desc: 'add tests for multiple modules', isGeneric: false };
        }

        // Pure test-only commit with no recognizable domain
        return { desc: 'add test coverage', isGeneric: false };
    }
    if (type === 'docs') {
        return { desc: 'update documentation', isGeneric: false };
    }

    // For feat/fix/refactor with multiple files — try domain-aware description
    const labels = detectDomainLabels(addedContent, changedFiles);
    if (labels.length > 0) {
        return { desc: `${verb} ${labels.join(' and ')}`, isGeneric: false };
    }

    const baseNames = changedFiles
        .map(f => f.split('/').pop().replace(/\.[^.]+$/, ''))
        .filter((n, i, arr) => arr.indexOf(n) === i); // unique names

    if (baseNames.length <= 2) {
        return { desc: `${verb} ${baseNames.join(' and ')}`, isGeneric: false };
    }

    // Too many files — flag as generic
    return { desc: `${verb} multiple modules`, isGeneric: true };
}

/**
 * Analyzes the staged (or unstaged) git diff and extracts structured metadata.
 * @param {string} rawDiff - The raw output from `git diff --staged` or `git diff`
 * @returns {DiffAnalysis}
 */
function analyzeDiff(rawDiff) {
    const diff = truncateDiff(rawDiff);
    const lines = diff.split('\n');

    const changedFiles = extractChangedFiles(lines);

    // Collect only added lines (not headers) for content-based heuristics
    const addedLines = lines.filter(l => l.startsWith('+') && !l.startsWith('+++'));

    const suggestedType  = detectType(changedFiles, addedLines);
    const suggestedScope = detectScope(changedFiles);
    const { desc: suggestedDesc, isGeneric } = buildDescription(suggestedType, changedFiles, addedLines);

    return {
        changedFiles,
        suggestedType,
        suggestedScope,
        suggestedDesc,
        isGeneric,
    };
}

module.exports = { analyzeDiff };
