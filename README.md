# VSCode TODO List

<div style="width: 100px;">
    <img src="media/logo.png" alt="Logo" width="100" />
</div>
A simple TODO list within VS Code
> It is designed to help developers (like me) to keep track of features we have to add, bugs we have to fix... Organising them instead of having random `# TODO` around the codebase
## Features

- Sidebar TODO panel with a live count badge.
- Manual TODO adding (via Add TODO item in the command pallet)
- Automatic detection of `# TODO` and `// TODO` comments across your workspace.
- Click a TODO item to jump to the source location.
- Tick the checkbox to complete an item:
    - Manual TODOs are removed from the list.
    - Comment-based TODOs remove the comment line from the source file.

- `.todoignore` to ignore paths (see below)

## Extension Settings

Create a `.todoignore` in project root to prevent certain files or directories from being displayed in the sidebar

### Example:
```
# Folders ignored by vscode-todo scanner
# One folder or glob pattern per line

node_modules
.git
dist
out
libs
coverage
build
```
## Release Notes


### 1.0.0

Initial release of VSCode TODO

- Added TODO side panel
- Added # TODO and // TODO detection
- Added manual TODO adding within command panel

---