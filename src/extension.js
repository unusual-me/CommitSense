const vscode = require('vscode');
const { getStagedDiff } = require('./git/getDiff');
const { analyzeDiff }   = require('./analyzer/analyzeDiff');
const { generateMessage } = require('./generator/generateMessage');
const { commitChanges } = require('./git/commit');

/**
 * Shows a QuickPick preview of the generated commit message and returns
 * the user's chosen action: 'commit' | 'edit' | 'cancel'.
 * @param {string} message
 * @returns {Promise<'commit' | 'edit' | 'cancel'>}
 */
async function showPreview(message) {
    const COMMIT = '✅  Commit';
    const EDIT   = '✏️  Edit Message';
    const CANCEL = '❌  Cancel';

    const pick = await vscode.window.showQuickPick(
        [COMMIT, EDIT, CANCEL],
        {
            title: 'CommitSense — Preview',
            placeHolder: `📝  ${message}`,
            ignoreFocusOut: true,
        }
    );

    if (!pick || pick === CANCEL) return 'cancel';
    if (pick === EDIT) return 'edit';
    return 'commit';
}

/**
 * Opens a pre-filled input box so the user can manually edit the message.
 * Returns the edited message, or null if the user dismissed the box.
 * @param {string} defaultMessage
 * @returns {Promise<string | null>}
 */
async function editMessage(defaultMessage) {
    return vscode.window.showInputBox({
        title: 'CommitSense — Edit Message',
        prompt: 'Edit the commit message, then press Enter to confirm',
        value: defaultMessage,
        ignoreFocusOut: true,
        validateInput: (val) => {
            if (!val || val.trim().length === 0) {
                return 'Commit message cannot be empty.';
            }
            if (val.length > 72) {
                return `Message is ${val.length} chars. Conventional Commits recommends ≤ 72. (You can still commit.)`;
            }
            return null;
        }
    });
}

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
    const disposable = vscode.commands.registerCommand(
        'commitSense.generateCommitMessage',
        async () => {
            // ── 1. Guard: workspace must be open ───────────────────────────
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) {
                vscode.window.showErrorMessage('CommitSense: Please open a workspace folder first.');
                return;
            }
            const workspacePath = workspaceFolders[0].uri.fsPath;

            // ── 2. Fetch staged diff ────────────────────────────────────────
            let diff;
            try {
                diff = await getStagedDiff(workspacePath);
            } catch (err) {
                vscode.window.showErrorMessage(`CommitSense: ${err.message}`);
                return;
            }

            if (!diff) {
                vscode.window.showErrorMessage(
                    'CommitSense: No staged changes found. Please stage files first (git add).'
                );
                return;
            }

            // ── 3. Analyze + generate ───────────────────────────────────────
            const analysis = analyzeDiff(diff);
            const { message, isGeneric, lengthWarning } = generateMessage(analysis);

            // Show non-blocking warnings
            if (isGeneric) {
                vscode.window.showWarningMessage(
                    'CommitSense: Generated message may be too generic. Consider editing it.'
                );
            }
            if (lengthWarning) {
                vscode.window.showWarningMessage(`CommitSense: ${lengthWarning}`);
            }

            // ── 4. Preview → QuickPick confirmation flow ────────────────────
            let finalMessage = message;

            // eslint-disable-next-line no-constant-condition
            while (true) {
                const action = await showPreview(finalMessage);

                if (action === 'cancel') {
                    // User explicitly cancelled — do nothing
                    return;
                }

                if (action === 'edit') {
                    const edited = await editMessage(finalMessage);
                    if (!edited) {
                        // User dismissed the input box — loop back to preview
                        continue;
                    }
                    finalMessage = edited.trim();
                    continue; // Show preview again with updated message
                }

                if (action === 'commit') {
                    break; // Proceed to commit
                }
            }

            // ── 5. Execute git commit ───────────────────────────────────────
            try {
                await commitChanges(workspacePath, finalMessage);
                vscode.window.showInformationMessage(
                    `CommitSense: ✅ Committed — "${finalMessage}"`
                );
            } catch (err) {
                vscode.window.showErrorMessage(`CommitSense: Commit failed — ${err.message}`);
            }
        }
    );

    context.subscriptions.push(disposable);
}

function deactivate() {}

module.exports = { activate, deactivate };
