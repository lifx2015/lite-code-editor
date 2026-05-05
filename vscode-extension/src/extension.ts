import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
    const disposable = vscode.commands.registerCommand(
        'liteCode.openMarkdownPreview',
        () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showWarningMessage('No active editor');
                return;
            }

            const doc = editor.document;
            if (doc.languageId !== 'markdown') {
                vscode.window.showWarningMessage(
                    'Current file is not a Markdown file'
                );
                return;
            }

            vscode.commands.executeCommand('markdown.showPreviewToSide', doc.uri);
        }
    );

    context.subscriptions.push(disposable);
}

export function deactivate() {}
