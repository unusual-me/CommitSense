# CommitSense

CommitSense is a lightweight, practical VS Code extension that generates meaningful, Conventional Commits-formatted Git commit messages based on your staged changes.

## Features

- Reads your staged git changes using `git diff --staged`.
- Analyzes the changes to determine the commit type (e.g., `feat`, `fix`, `chore`) and scope.
- Generates a commit message locally directly in your editor.
- Allows you to review and edit the generated message before confirming.
- Automatically commits the staged files with the generated message.

## Usage

1. Stage the files you wish to commit (`git add <file>`).
2. Open the Command Palette in VS Code (`Cmd+Shift+P` on Mac or `Ctrl+Shift+P` on Windows/Linux).
3. Search for and run **`CommitSense: Generate Commit Message`**.
4. An input box will appear pre-populated with a generated Conventional Commit message.
5. Review the message, make any desired tweaks, and press `Enter` to confirm and trigger `git commit`.

## Requirements

- Git must be installed and initialized in your workspace.
- You must have staged files prior to running the command.

## Release Notes

### 1.0.0
Initial release of CommitSense!
