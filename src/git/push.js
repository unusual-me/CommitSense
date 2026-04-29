const { execFile } = require('child_process');

/**
 * Pushes committed changes to the remote on the current branch.
 * @param {string} cwd - Workspace directory path.
 * @returns {Promise<void>}
 */
function pushChanges(cwd) {
    return new Promise((resolve, reject) => {
        execFile('git', ['push'], { cwd }, (error, stdout, stderr) => {
            if (error) {
                return reject(new Error(stderr || stdout || error.message));
            }
            resolve();
        });
    });
}

module.exports = { pushChanges };
