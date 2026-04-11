/**
 * Analyzes the git diff string and extracts metadata.
 * @param {string} diffOutput - The raw output from `git diff --staged`
 * @returns {Object} Extracted data: { changedFiles, types, keywords, suggestedType, suggestedScope, suggestedDesc }
 */
function analyzeDiff(diffOutput) {
    const lines = diffOutput.split('\n');
    const changedFiles = [];
    let isTest = false;
    let isChore = false;
    let isRefactor = false;
    let isFix = false;

    // Regex to parse "diff --git a/src/index.js b/src/index.js"
    const diffRegex = /^diff --git a\/(.+?) b\/(.+?)$/;

    for (const line of lines) {
        if (line.startsWith('diff --git')) {
            const match = line.match(diffRegex);
            if (match && match[2]) {
                const filePath = match[2];
                if (!changedFiles.includes(filePath)) {
                    changedFiles.push(filePath);
                }
            }
        }
        
        // Internal lines rules for fix/refactoring classification
        const lowerLine = line.toLowerCase();
        if (line.startsWith('+') && !line.startsWith('+++')) {
            if (lowerLine.includes('fix') || lowerLine.includes('bug')) isFix = true;
            if (lowerLine.includes('refactor') || lowerLine.includes('cleanup')) isRefactor = true;
        }
    }

    // Determine type by file paths
    for (const file of changedFiles) {
        if (file.includes('.test.') || file.includes('.spec.') || file.includes('__tests__')) {
            isTest = true;
        }
        if (file.includes('package.json') || file.includes('webpack.config') || file.includes('.eslintrc') || file.startsWith('.github/') || file.includes('.ignore')) {
            isChore = true;
        }
    }

    // Determine keywords from paths
    const commonScopes = ['auth', 'user', 'payment', 'ui', 'api', 'db', 'wallet', 'transaction', 'notification', 'config'];
    let suggestedScope = '';
    
    // Extract path segments for scope matching
    const allSegments = changedFiles.map(f => f.split('/')).flat().map(s => s.toLowerCase());
    for (const scope of commonScopes) {
        if (allSegments.some(segment => segment.includes(scope))) {
            suggestedScope = scope;
            break; 
        }
    }

    // Fallback scope: parent directory name of a single changed file
    if (!suggestedScope && changedFiles.length === 1) {
        const segments = changedFiles[0].split('/');
        if (segments.length > 1) {
            suggestedScope = segments[segments.length - 2];
        }
    }

    // Determine suggested type based on priority
    let suggestedType = 'feat'; // default
    if (isTest) suggestedType = 'test';
    else if (isChore) suggestedType = 'chore';
    else if (isFix) suggestedType = 'fix';
    else if (isRefactor) suggestedType = 'refactor';
    else if (changedFiles.length > 0 && changedFiles.every(f => f.endsWith('.md') || f.endsWith('.txt'))) {
        suggestedType = 'docs';
    }

    // Determine description based on files changed and type
    let suggestedDesc = 'update code';
    if (changedFiles.length === 1) {
        const fileParts = changedFiles[0].split('/');
        const fileName = fileParts[fileParts.length - 1];
        if (suggestedType === 'test') {
            suggestedDesc = `add tests for ${fileName}`;
        } else if (suggestedType === 'chore') {
            suggestedDesc = `update ${fileName}`;
        } else {
            suggestedDesc = `modify ${fileName}`;
        }
    } else if (changedFiles.length > 1) {
        if (suggestedType === 'chore') {
            suggestedDesc = 'update configuration dependencies';
        } else if (suggestedType === 'test') {
            suggestedDesc = 'add various test suites';
        } else {
            const fileNames = changedFiles.map(f => f.split('/').pop().split('.')[0]);
            suggestedDesc = `update ${fileNames.slice(0, 2).join(' and ')}${fileNames.length > 2 ? ' and others' : ''}`;
        }
    }

    return {
        changedFiles,
        suggestedType,
        suggestedScope,
        suggestedDesc
    };
}

module.exports = { analyzeDiff };
