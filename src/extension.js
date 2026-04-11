const vscode = require('vscode');
const { getStagedDiff } = require('./git/getDiff');
const { analyzeDiff } = require('./analyzer/analyzeDiff');
const { generateMessage } = require('./generator/generateMessage');
const { commitChanges } = require('./git/commit');

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
    let disposable = vscode.commands.registerCommand('commitSense.generateCommitMessage', async () => {
        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) {
                vscode.window.showErrorMessage('CommitSense: Please open a workspace folder first.');
                return;
            }

            const workspacePath = workspaceFolders[0].uri.fsPath;
            
            // 1. Get Diff
            let diff;
            try {
                diff = await getStagedDiff(workspacePath);
            } catch (err) {
                vscode.window.showErrorMessage(`CommitSense: ${err.message}`);
                return;
            }

            if (!diff) {
                vscode.window.showInformationMessage('CommitSense: No staged changes found.');
                return;
            }

            // 2. Analyze Diff
            const analysis = analyzeDiff(diff);

            // 3. Generate Message
            const defaultMessage = generateMessage(analysis);

            // 4. Show Input Box
            const commitMessage = await vscode.window.showInputBox({
                prompt: 'Edit commit message or press Enter to confirm',
                value: defaultMessage,
                ignoreFocusOut: true,
            });

            if (commitMessage) {
                // 5. Commit
                await commitChanges(workspacePath, commitMessage);
                vscode.window.showInformationMessage('CommitSense: Successfully committed changes!');
            }
        } catch (error) {
            vscode.window.showErrorMessage(`CommitSense Error: ${error.message}`);
        }
    });

    context.subscriptions.push(disposable);
}

function deactivate() {}

module.exports = {
    activate,
    deactivate
};
