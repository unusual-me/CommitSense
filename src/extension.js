const vscode = require('vscode');
const { getStagedDiff, getUnstagedDiff } = require('./git/getDiff');
const { analyzeDiff }   = require('./analyzer/analyzeDiff');
const { generateMessage } = require('./generator/generateMessage');
const { commitChanges } = require('./git/commit');
const { pushChanges }   = require('./git/push');

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
 * Shows a Yes/No QuickPick confirmation dialog.
 * @param {string} title
 * @param {string} placeHolder
 * @returns {Promise<boolean>} true if user selected Yes, false otherwise
 */
async function confirmAction(title, placeHolder) {
    const YES = '$(check)  Yes';
    const NO  = '$(close)  No';
    const pick = await vscode.window.showQuickPick([YES, NO], {
        title,
        placeHolder,
        ignoreFocusOut: true,
    });
    return pick === YES;
}

/**
 * Handles the push-after-commit flow.
 * Respects the commitSense.enablePushPrompt configuration setting.
 * @param {string} workspacePath
 */
async function promptPush(workspacePath) {
    const config = vscode.workspace.getConfiguration('commitSense');
    if (!config.get('enablePushPrompt')) return;

    const wantPush = await confirmAction(
        'CommitSense — Push Changes',
        'Do you want to push changes to the current branch?'
    );
    if (!wantPush) return;

    const confirmed = await confirmAction(
        'CommitSense — Confirm Push',
        'Are you sure you want to push to the remote?'
    );
    if (!confirmed) return;

    try {
        await pushChanges(workspacePath);
        vscode.window.showInformationMessage('CommitSense: 🚀 Pushed successfully!');
    } catch (err) {
        vscode.window.showErrorMessage(`CommitSense: Push failed — ${err.message}`);
    }
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

            // ── 2. Fetch staged diff, fall back to unstaged if empty ────────
            let diff;
            try {
                diff = await getStagedDiff(workspacePath);
            } catch (err) {
                vscode.window.showErrorMessage(`CommitSense: ${err.message}`);
                return;
            }

            if (!diff) {
                // No staged changes — ask user if they want to use all changes
                const useUnstaged = await confirmAction(
                    'CommitSense — No Staged Changes',
                    'No staged changes found. Generate from all working-tree changes?'
                );
                if (!useUnstaged) return;

                try {
                    diff = await getUnstagedDiff(workspacePath);
                } catch (err) {
                    vscode.window.showErrorMessage(`CommitSense: ${err.message}`);
                    return;
                }

                if (!diff) {
                    vscode.window.showErrorMessage(
                        'CommitSense: No changes found at all. Make some edits first.'
                    );
                    return;
                }
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
                    // ── 5. Optional commit confirmation ─────────────────────
                    const config = vscode.workspace.getConfiguration('commitSense');
                    if (config.get('confirmCommit')) {
                        const confirmed = await confirmAction(
                            'CommitSense — Confirm Commit',
                            `Are you sure you want to commit? "${finalMessage}"`
                        );
                        if (!confirmed) {
                            // Loop back to preview so user can reconsider
                            continue;
                        }
                    }
                    break; // Proceed to commit
                }
            }

            // ── 6. Execute git commit ───────────────────────────────────────
            try {
                await commitChanges(workspacePath, finalMessage);
                vscode.window.showInformationMessage(
                    `CommitSense: ✅ Committed — "${finalMessage}"`
                );
            } catch (err) {
                vscode.window.showErrorMessage(`CommitSense: Commit failed — ${err.message}`);
                return;
            }

            // ── 7. Offer to push ────────────────────────────────────────────
            await promptPush(workspacePath);
        }
    );

    context.subscriptions.push(disposable);
}

function deactivate() {}

module.exports = { activate, deactivate };
