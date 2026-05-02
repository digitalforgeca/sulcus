const vscode = require('vscode');

function activate(context) {
  const cmd = vscode.commands.registerCommand('sulcus-sample.useApi', async () => {
    const ext = vscode.extensions.getExtension('your-publisher.sulcus-vscode');
    if (!ext) {
      vscode.window.showErrorMessage('Sulcus extension not found in this VS Code instance.');
      return;
    }

    // activate and get exported API
    const api = await ext.activate();

    // call API methods (demonstration)
    await api.summarizeSelection();
    vscode.window.showInformationMessage('Called Sulcus.summarizeSelection — last summary: ' + (api.getLastSummary() || '<none>'));
    api.showOutput();
  });

  context.subscriptions.push(cmd);
}

function deactivate() {}

module.exports = { activate, deactivate };