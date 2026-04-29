// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed

class TodoProvider implements vscode.TreeDataProvider<string> {
	private readonly itemsList: string[] = [];
	private readonly _onDidChangeTreeData = new vscode.EventEmitter<string | undefined | null | void>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	addItem(item: string): void {
		this.itemsList.push(item);
		this.refresh();
	}

  getTreeItem(element: string): vscode.TreeItem {
		const treeItem = new vscode.TreeItem(element);
		treeItem.command = {
			command: 'vscode-todo.itemClicked',
			title: 'Open Todo Item',
			arguments: [element]
		};
		return treeItem;
  }

  getChildren(): string[] {
    return this.itemsList;
  }
}

async function handleAddNew(provider: TodoProvider) {
	const value = await vscode.window.showInputBox({ placeHolder: 'Input TODO' });
	if (!value) {
		return;
	}
	provider.addItem(value);
}

function handleItemClicked(item: string) {
	vscode.window.showInformationMessage(`Clicked TODO: ${item}`);
}

export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "vscode-todo" is now active!');



	const provider = new TodoProvider();

	const treeView = vscode.window.createTreeView('vscode-todo.todos', {
		treeDataProvider: provider
	});

	// Add new TODO 
	const disposable = vscode.commands.registerCommand('vscode-todo.addNew', async () => {
		await handleAddNew(provider);
	});

	const itemClickedDisposable = vscode.commands.registerCommand('vscode-todo.itemClicked', (item: string) => {
		handleItemClicked(item);
	});

	context.subscriptions.push(disposable, itemClickedDisposable, treeView);
}

// This method is called when your extension is deactivated
export function deactivate() {}
