import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SulcusConfiguration } from '../types';

export function getSulcusConfig(): SulcusConfiguration {
  const wsConfig = vscode.workspace.getConfiguration('sulcus');

  let serverUrl =
    wsConfig.get<string>('serverUrl') ||
    process.env.SULCUS_SERVER_URL ||
    process.env.SULCUS_BASE_URL ||
    'https://api.sulcus.ca';

  let apiKey =
    wsConfig.get<string>('apiKey') ||
    process.env.SULCUS_API_KEY ||
    '';

  let namespace =
    wsConfig.get<string>('namespace') ||
    process.env.SULCUS_NAMESPACE ||
    'default';

  const binPath =
    wsConfig.get<string>('binPath') ||
    'sulcus';

  const autoStartDaemon =
    wsConfig.get<boolean>('autoStartDaemon', true);

  const daemonPort =
    wsConfig.get<number>('daemonPort', 4203);

  const hybridMode =
    wsConfig.get<boolean>('hybridMode', true);

  const maxSummaryChars =
    wsConfig.get<number>('maxSummaryChars', 500);

  const autoRecallLimit =
    wsConfig.get<number>('recall.limit', wsConfig.get<number>('autoRecallLimit', 10));

  const vcrGateInspect = wsConfig.inspect<boolean>('capture.useVcrQualityGate');
  const explicitVcrGate =
    vcrGateInspect?.workspaceFolderValue ??
    vcrGateInspect?.workspaceValue ??
    vcrGateInspect?.globalValue;
  const siuGateInspect = wsConfig.inspect<boolean>('capture.useSiuQualityGate');
  const explicitSiuGate =
    siuGateInspect?.workspaceFolderValue ??
    siuGateInspect?.workspaceValue ??
    siuGateInspect?.globalValue;
  const useVcrQualityGate =
    explicitVcrGate ??
    explicitSiuGate ??
    wsConfig.get<boolean>('capture.useVcrQualityGate') ??
    wsConfig.get<boolean>('capture.useSiuQualityGate') ??
    true;

  // Fall back to ~/.config/sulcus/sulcus.ini if apiKey or serverUrl not provided
  try {
    const homeDir = os.homedir();
    const iniPath = path.join(homeDir, '.config', 'sulcus', 'sulcus.ini');
    if (fs.existsSync(iniPath)) {
      const lines = fs.readFileSync(iniPath, 'utf8').split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('#') || trimmed.startsWith('[')) continue;

        const eqIdx = trimmed.indexOf('=');
        if (eqIdx <= 0) continue;
        const key = trimmed.slice(0, eqIdx).trim().toLowerCase();
        const val = trimmed.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, '');

        if (key === 'server_url' && (!wsConfig.get<string>('serverUrl') && !process.env.SULCUS_SERVER_URL)) {
          if (val) serverUrl = val.replace(/\/api\/v[12]\/sync\/?$/, '');
        }
        if ((key === 'server_api_key' || key === 'api_key') && (!wsConfig.get<string>('apiKey') && !process.env.SULCUS_API_KEY)) {
          if (val) apiKey = val;
        }
        if ((key === 'namespace' || key === 'default_namespace') && (!wsConfig.get<string>('namespace') && !process.env.SULCUS_NAMESPACE)) {
          if (val) namespace = val;
        }
      }
    }
  } catch {
    // Ignore ini read errors
  }

  return {
    serverUrl,
    apiKey,
    namespace,
    binPath,
    autoStartDaemon,
    daemonPort,
    hybridMode,
    maxSummaryChars,
    autoRecallLimit,
    useVcrQualityGate
  };
}

export function setSulcusNamespace(namespace: string): Thenable<void> {
  const wsConfig = vscode.workspace.getConfiguration('sulcus');
  return wsConfig.update('namespace', namespace, vscode.ConfigurationTarget.Global);
}

export function setSulcusServerUrl(url: string): Thenable<void> {
  const wsConfig = vscode.workspace.getConfiguration('sulcus');
  return wsConfig.update('serverUrl', url, vscode.ConfigurationTarget.Global);
}

export function setSulcusApiKey(key: string): Thenable<void> {
  const wsConfig = vscode.workspace.getConfiguration('sulcus');
  return wsConfig.update('apiKey', key, vscode.ConfigurationTarget.Global);
}
