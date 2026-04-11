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

    const isDocs = changedFiles.every(f => f.endsWith('.md') || f.endsWith('.txt') || f.endsWith('.rst'));
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
 * Generates a human-readable description using strong action verbs.
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

    const verb = VERB_MAP[type] || 'update';
    const addedContent = addedLines.join(' ').toLowerCase();

    // Single file
    if (changedFiles.length === 1) {
        const parts = changedFiles[0].split('/');
        // Strip extension and use base name
        const baseName = parts[parts.length - 1].replace(/\.[^.]+$/, '');

        if (type === 'fix') {
            // Try to be more specific about what was fixed
            if (addedContent.includes('validation') || addedContent.includes('validate')) {
                return { desc: `resolve ${baseName} validation issue`, isGeneric: false };
            }
            if (addedContent.includes('error') || addedContent.includes('exception')) {
                return { desc: `handle ${baseName} error`, isGeneric: false };
            }
            return { desc: `resolve issue in ${baseName}`, isGeneric: false };
        }

        if (type === 'feat') {
            if (addedContent.includes('class') || addedContent.includes('function') || addedContent.includes('const')) {
                return { desc: `implement ${baseName} logic`, isGeneric: false };
            }
            return { desc: `add ${baseName}`, isGeneric: false };
        }

        return { desc: `${verb} ${baseName}`, isGeneric: false };
    }

    // Multiple files
    const baseNames = changedFiles
        .map(f => f.split('/').pop().replace(/\.[^.]+$/, ''))
        .filter((n, i, arr) => arr.indexOf(n) === i); // unique names

    if (type === 'chore') {
        return { desc: 'update project configuration', isGeneric: false };
    }
    if (type === 'test') {
        return { desc: 'add test coverage', isGeneric: false };
    }
    if (type === 'docs') {
        return { desc: 'update documentation', isGeneric: false };
    }

    if (baseNames.length <= 2) {
        return { desc: `${verb} ${baseNames.join(' and ')}`, isGeneric: false };
    }

    // Too many files — flag as generic
    return { desc: `${verb} multiple modules`, isGeneric: true };
}

/**
 * Analyzes the staged git diff and extracts structured metadata.
 * @param {string} rawDiff - The raw output from `git diff --staged`
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
