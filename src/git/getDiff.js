const { exec } = require('child_process');

/**
 * Retrieves the currently staged diff in the repository.
 * @param {string} cwd - The workspace directory path.
 * @returns {Promise<string>} The output of git diff --staged
 */
function getStagedDiff(cwd) {
    return new Promise((resolve, reject) => {
        exec('git diff --staged', { cwd, maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
            if (error) {
                if (stderr.includes('not a git repository')) {
                    return reject(new Error('Workspace is not a git repository.'));
                }
                return reject(new Error(stderr || error.message));
            }
            resolve(stdout.trim());
        });
    });
}

module.exports = { getStagedDiff };
