const { execFile } = require('child_process');

/**
 * Commits the staged changes with the provided message.
 * @param {string} cwd - Workspace directory path.
 * @param {string} message - Commit message.
 * @returns {Promise<void>}
 */
function commitChanges(cwd, message) {
    return new Promise((resolve, reject) => {
        execFile('git', ['commit', '-m', message], { cwd }, (error, stdout, stderr) => {
            if (error) {
                return reject(new Error(stderr || stdout || error.message));
            }
            resolve();
        });
    });
}

module.exports = { commitChanges };
