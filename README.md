# 🧠 CommitSense

CommitSense is a blazing-fast, lightweight VS Code extension that automatically generates meaningful, [Conventional Commits](https://www.conventionalcommits.org/)-formatted Git commit messages based on your staged changes. No AI configuration required—just smart, rule-based heuristics that run instantly on your machine.

## ✨ Features

- **⚡ Instant Generation**: Analyzes your `git diff` and generates messages locally in milliseconds.
- **🎯 Smart Domain Detection**: Automatically recognizes the domain of your work (e.g., `auth`, `payment`, `api`, `db`, `ui`) based on file paths and code content.
- **🔀 Unstaged Fallback**: Forgot to stage your files? CommitSense will gracefully offer to generate a message from your unstaged working tree changes instead.
- **🚀 One-Click SCM Integration**: Generate messages directly from the Source Control (SCM) view using the new `Commit` icon in the title bar.
- **⌨️ Keyboard Shortcuts**: Trigger generation instantly with `Ctrl+Alt+C` (Windows/Linux) or `Cmd+Alt+C` (Mac).
- **🔄 Commit & Push Workflow**: After committing, CommitSense can optionally prompt you to push directly to your remote branch.

## 🚀 Usage

There are three ways to use CommitSense:

1. **Source Control Panel**: Click the **Generate Commit Message** `(git-commit)` icon in the top right of the Source Control view.
2. **Keyboard Shortcut**: Press `Cmd+Alt+C` (Mac) or `Ctrl+Alt+C` (Windows/Linux).
3. **Command Palette**: Press `Cmd+Shift+P` (Mac) or `Ctrl+Shift+P` (Windows/Linux), type **CommitSense**, and hit Enter.

An input box will appear pre-populated with your generated commit message. You can tweak the message if needed, and hit `Enter` to commit your changes!

## ⚙️ Extension Settings

You can customize the CommitSense workflow by tweaking these settings in your VS Code `settings.json`:

| Setting | Default | Description |
|---|---|---|
| `commitSense.confirmCommit` | `true` | Show a confirmation dialog before actually executing the `git commit` command. |
| `commitSense.enablePushPrompt` | `true` | Show a prompt asking if you'd like to `git push` immediately after a successful commit. |

## 📋 Requirements

- Git must be installed and initialized in your workspace.
- Works best when changes are focused on a specific feature or fix.

## 📝 Release Notes

### 1.1.0
- **New**: Added Keyboard Shortcut (`Cmd/Ctrl+Alt+C`).
- **New**: Added Source Control Panel button integration.
- **New**: Support for unstaged changes (fallback flow).
- **New**: Commit confirmation & push-to-remote workflows (configurable in settings).
- **Improved**: Significantly smarter domain-aware message generation heuristics.
- **Improved**: Better handling of multi-file commits and test files.

### 1.0.0
- Initial release of CommitSense!
