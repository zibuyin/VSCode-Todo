// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed

type TodoSource = 'manual' | 'detected';

interface TodoItem {
	id: string;
	label: string;
	source: TodoSource;
	locationUri?: string;
	line?: number;
	locationText?: string;
}

const DEFAULT_IGNORED_FOLDERS = ['node_modules', 'dist', 'out', '.git', 'libs'];

function buildExcludePattern(ignoreEntries: string[]): string {
	const uniquePatterns = Array.from(new Set(ignoreEntries.map((entry) => entry.trim()).filter(Boolean)));
	if (uniquePatterns.length === 0) {
		return '**/.git/**';
	}

	return `{${uniquePatterns.join(',')}}`;
}

async function getTodoIgnoreEntries(): Promise<string[]> {
	const patterns: string[] = DEFAULT_IGNORED_FOLDERS.map((folder) => `**/${folder}/**`);
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	if (!workspaceFolder) {
		return patterns;
	}

	const ignoreFileUri = vscode.Uri.joinPath(workspaceFolder.uri, '.todoignore');

	try {
		const raw = new TextDecoder('utf-8').decode(await vscode.workspace.fs.readFile(ignoreFileUri));
		const lines = raw.split(/\r?\n/);
		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith('#')) {
				continue;
			}

			const normalized = trimmed.replace(/^\.\//, '').replace(/\/$/, '');
			if (!normalized) {
				continue;
			}

			if (normalized.includes('*')) {
				patterns.push(normalized);
			} else if (normalized.includes('/')) {
				patterns.push(`${normalized}/**`);
				patterns.push(`**/${normalized}/**`);
			} else {
				patterns.push(`**/${normalized}/**`);
			}
		}
	} catch {
		// .todoignore is optional. If it's missing or unreadable, defaults still apply.
	}

	return patterns;
}

function isTodoItem(value: unknown): value is TodoItem {
	if (!value || typeof value !== 'object') {
		return false;
	}

	const candidate = value as Partial<TodoItem>;
	return typeof candidate.id === 'string'
		&& typeof candidate.label === 'string'
		&& (candidate.source === 'manual' || candidate.source === 'detected');
}

function parseLegacyItem(item: string): TodoItem {
	const detectedMatch = item.match(/^(.+):(\d+)\s+(.+)$/);
	if (!detectedMatch) {
		return {
			id: `manual:${item}`,
			label: item,
			source: 'manual'
		};
	}

	const relativePath = detectedMatch[1];
	const line = Number(detectedMatch[2]);
	const label = detectedMatch[3];
	const targetFile = vscode.workspace.workspaceFolders
		? vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, relativePath)
		: undefined;

	return {
		id: `detected:${relativePath}:${line}:${label}`,
		label,
		source: 'detected',
		line,
		locationUri: targetFile?.toString(),
		locationText: `${relativePath}:${line}`
	};
}

class TodoProvider implements vscode.TreeDataProvider<TodoItem> {
	private readonly itemsList: TodoItem[] = [];
	private readonly onItemsChanged: (items: TodoItem[]) => void | Thenable<void>;
	private readonly _onDidChangeTreeData = new vscode.EventEmitter<TodoItem | undefined | null | void>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	constructor(initialItems: TodoItem[], onItemsChanged: (items: TodoItem[]) => void | Thenable<void>) {
		this.itemsList.push(...initialItems);
		this.onItemsChanged = onItemsChanged;
	}

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	addItem(item: TodoItem): void {
		this.itemsList.push(item);
		void this.onItemsChanged([...this.itemsList]);
		this.refresh();
	}

	setItems(items: TodoItem[]): void {
		this.itemsList.splice(0, this.itemsList.length, ...items);
		void this.onItemsChanged([...this.itemsList]);
		this.refresh();
	}

	getItems(): TodoItem[] {
		return [...this.itemsList];
	}

	removeItemsById(ids: Set<string>): number {
		const before = this.itemsList.length;
		const kept = this.itemsList.filter((item) => !ids.has(item.id));
		if (kept.length === before) {
			return 0;
		}

		this.itemsList.splice(0, this.itemsList.length, ...kept);
		void this.onItemsChanged([...this.itemsList]);
		this.refresh();
		return before - kept.length;
	}

	getTreeItem(element: TodoItem): vscode.TreeItem {
		const treeItem = new vscode.TreeItem(element.label);
		treeItem.checkboxState = vscode.TreeItemCheckboxState.Unchecked;
		treeItem.description = element.locationText;
		treeItem.tooltip = element.locationText ? `${element.label}\n${element.locationText}` : element.label;
		treeItem.command = {
			command: 'vscode-todo.itemClicked',
			title: 'Open Todo Item',
			arguments: [element]
		};
		return treeItem;
	}

	getChildren(): TodoItem[] {
		return this.itemsList;
	}
}

async function handleAddNew(provider: TodoProvider) {
	const value = await vscode.window.showInputBox({ placeHolder: 'Input TODO' });
	if (!value) {
		return;
	}
	provider.addItem({
		id: `manual:${Date.now()}:${Math.random().toString(36).slice(2)}`,
		label: value,
		source: 'manual'
	});
}


async function handleItemClicked(item: TodoItem) {
	if (!item.locationUri || typeof item.line !== 'number') {
		return;
	}

	const targetUri = vscode.Uri.parse(item.locationUri);
	const doc = await vscode.workspace.openTextDocument(targetUri);
	const editor = await vscode.window.showTextDocument(doc, { preview: false });
	const target = new vscode.Position(Math.max(item.line - 1, 0), 0);
	editor.selection = new vscode.Selection(target, target);
	editor.revealRange(new vscode.Range(target, target), vscode.TextEditorRevealType.InCenter);
}

async function removeDetectedTodoCommentLines(items: TodoItem[]): Promise<number> {
	const deletionsByUri = new Map<string, Set<number>>();
	for (const item of items) {
		if (!item.locationUri || typeof item.line !== 'number' || item.line < 1) {
			continue;
		}

		const existing = deletionsByUri.get(item.locationUri) ?? new Set<number>();
		existing.add(item.line);
		deletionsByUri.set(item.locationUri, existing);
	}

	if (deletionsByUri.size === 0) {
		return 0;
	}

	const edit = new vscode.WorkspaceEdit();
	const touchedDocs: vscode.TextDocument[] = [];
	let plannedDeletions = 0;

	for (const [uriString, lines] of deletionsByUri) {
		const uri = vscode.Uri.parse(uriString);
		const doc = await vscode.workspace.openTextDocument(uri);
		touchedDocs.push(doc);

		const sortedLines = Array.from(lines).sort((a, b) => b - a);
		for (const lineNumber of sortedLines) {
			const lineIndex = lineNumber - 1;
			if (lineIndex < 0 || lineIndex >= doc.lineCount) {
				continue;
			}

			const lineRange = doc.lineAt(lineIndex).rangeIncludingLineBreak;
			edit.delete(uri, lineRange);
			plannedDeletions += 1;
		}
	}

	if (plannedDeletions === 0) {
		return 0;
	}

	const applied = await vscode.workspace.applyEdit(edit);
	if (!applied) {
		return 0;
	}

	await Promise.all(touchedDocs.map(async (doc) => {
		if (!doc.isUntitled) {
			await doc.save();
		}
	}));

	return plannedDeletions;
}

async function registerWorkspaceTodos(provider: TodoProvider): Promise<void> {
	const ignoreEntries = await getTodoIgnoreEntries();
	const excludePattern = buildExcludePattern(ignoreEntries);
	const files = await vscode.workspace.findFiles(
		'**/*',
		excludePattern
	);

	const todoPattern = /(?:\/\/|#)\s*TODO\b[:\-\s]*(.*)/i;
	const detectedTodos: TodoItem[] = [];

	for (const file of files) {
		try {
			const openDocument = vscode.workspace.textDocuments.find((document) => document.uri.toString() === file.toString());
			const content = openDocument
				? openDocument.getText()
				: new TextDecoder('utf-8').decode(await vscode.workspace.fs.readFile(file));

			const lines = content.split(/\r?\n/);
			for (let i = 0; i < lines.length; i++) {
				const lineText = lines[i];
				const match = lineText.match(todoPattern);
				if (!match) {
					continue;
				}

				const todoText = match[1].trim() || 'TODO';
				const relativePath = vscode.workspace.asRelativePath(file, false);
				detectedTodos.push({
					id: `detected:${relativePath}:${i + 1}:${todoText}`,
					label: todoText,
					source: 'detected',
					line: i + 1,
					locationUri: file.toString(),
					locationText: `${relativePath}:${i + 1}`
				});
			}
		} catch (error) {
			console.warn(`Skipping file while scanning TODOs: ${file.toString()}`, error);
		}
	}

	const existingItems = provider.getItems();
	const manualItems = existingItems.filter((item) => item.source === 'manual');
	const mergedItems = [...manualItems, ...detectedTodos];
	provider.setItems(mergedItems);
}

export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "vscode-todo" is now active!');



	const storageKey = 'vscode-todo.items';
	const savedItemsRaw = context.globalState.get<unknown[]>(storageKey, []);
	const savedItems = savedItemsRaw
		.map((item) => {
			if (isTodoItem(item)) {
				return item;
			}

			if (typeof item === 'string') {
				return parseLegacyItem(item);
			}

			return undefined;
		})
		.filter((item): item is TodoItem => Boolean(item));

	const provider = new TodoProvider(savedItems, (items: TodoItem[]) => context.globalState.update(storageKey, items));

	const treeView = vscode.window.createTreeView('vscode-todo.todos', {
		treeDataProvider: provider
	});

	const updateBadge = () => {
		const total = provider.getItems().length;
		treeView.badge = total > 0
			? { value: total, tooltip: `${total} TODO item${total === 1 ? '' : 's'}` }
			: undefined;
	};

	const treeDataChangedDisposable = provider.onDidChangeTreeData(() => {
		updateBadge();
	});
	updateBadge();

	// Add new TODO 
	const disposable = vscode.commands.registerCommand('vscode-todo.addNew', async () => {
		await handleAddNew(provider);
	});

	const itemClickedDisposable = vscode.commands.registerCommand('vscode-todo.itemClicked', (item: TodoItem) => {
		void handleItemClicked(item);
	});

	const checkboxChangedDisposable = treeView.onDidChangeCheckboxState((event) => {
		void (async () => {
			const checkedItems = event.items
				.filter(([, state]) => state === vscode.TreeItemCheckboxState.Checked)
				.map(([item]) => item);

			const manualIds = new Set(
				checkedItems
					.filter((item) => item.source === 'manual')
					.map((item) => item.id)
			);
			const removedManual = provider.removeItemsById(manualIds);

			const detectedItems = checkedItems.filter((item) => item.source === 'detected');
			const removedDetectedLines = await removeDetectedTodoCommentLines(detectedItems);
			if (removedDetectedLines > 0) {
				scheduleTodoSync();
			}

			const totalRemoved = removedManual + removedDetectedLines;
			if (totalRemoved > 0) {
				void vscode.window.showInformationMessage(`Completed ${totalRemoved} TODO item${totalRemoved === 1 ? '' : 's'}`);
			}
		})();
	});

	let syncTimer: NodeJS.Timeout | undefined;
	const scheduleTodoSync = () => {
		if (syncTimer) {
			clearTimeout(syncTimer);
		}

		syncTimer = setTimeout(() => {
			void registerWorkspaceTodos(provider);
		}, 300);
	};

	const documentChangeDisposable = vscode.workspace.onDidChangeTextDocument(() => {
		scheduleTodoSync();
	});

	const documentSaveDisposable = vscode.workspace.onDidSaveTextDocument(() => {
		scheduleTodoSync();
	});

	const fileCreateDisposable = vscode.workspace.onDidCreateFiles(() => {
		scheduleTodoSync();
	});

	const fileDeleteDisposable = vscode.workspace.onDidDeleteFiles(() => {
		scheduleTodoSync();
	});

	scheduleTodoSync();

	context.subscriptions.push(
		disposable,
		itemClickedDisposable,
		checkboxChangedDisposable,
		treeDataChangedDisposable,
		documentChangeDisposable,
		documentSaveDisposable,
		fileCreateDisposable,
		fileDeleteDisposable,
		treeView,
		{ dispose: () => syncTimer && clearTimeout(syncTimer) }
	);
}

// This method is called when your extension is deactivated
export function deactivate() {}
