import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import * as http from 'http';
import * as https from 'https';
import {
  CreateMemoryParams,
  DashboardStats,
  EntityContextResponse,
  FeedbackParams,
  MemoryNode,
  SearchOptions,
  SearchResult,
  SIULabelResponse,
  SulcusConfiguration
} from '../types';
import { getSulcusConfig } from '../config/config';

export class SulcusClient {
  private config: SulcusConfiguration;
  private static cachedMachineId: string | null = null;

  public static getMachineId(): string {
    if (SulcusClient.cachedMachineId) {
      return SulcusClient.cachedMachineId;
    }
    const envOverride = process.env.SULCUS_MACHINE_ID?.trim();
    if (envOverride) {
      SulcusClient.cachedMachineId = envOverride;
      return envOverride;
    }
    const idPath =
      process.env.SULCUS_MACHINE_ID_PATH?.trim() ||
      path.join(os.homedir(), '.config', 'sulcus', 'machine_id');
    try {
      if (fs.existsSync(idPath)) {
        const existing = fs.readFileSync(idPath, 'utf8').trim();
        if (/^[a-zA-Z0-9_-]{8,128}$/.test(existing)) {
          SulcusClient.cachedMachineId = existing;
          return existing;
        }
      }
    } catch {
      // Fall through to deterministic computation
    }

    let username = 'user';
    try {
      username = os.userInfo().username || 'user';
    } catch {
      username = process.env.USER || process.env.USERNAME || 'user';
    }
    const shortHost = (os.hostname() || 'workstation').trim().split('.')[0].trim().toLowerCase() || 'workstation';
    const cleanUser = username.trim().toLowerCase() || 'user';
    const plat = os.platform().toLowerCase();
    const canonicalOs = plat.includes('darwin') || plat.includes('mac')
      ? 'macos'
      : plat.includes('win')
        ? 'windows'
        : plat.includes('linux')
          ? 'linux'
          : (plat || 'unknown');
    const raw = `${shortHost}:${cleanUser}:${canonicalOs}`;
    const computed = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 32);
    try {
      const dir = path.dirname(idPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      }
      fs.writeFileSync(idPath, `${computed}\n`, { mode: 0o600 });
    } catch {
      // Best-effort persistence
    }
    SulcusClient.cachedMachineId = computed;
    return computed;
  }

  constructor(config?: SulcusConfiguration) {
    this.config = config || getSulcusConfig();
  }

  public updateConfig(config: Partial<SulcusConfiguration>) {
    this.config = { ...this.config, ...config };
  }

  public getConfig(): SulcusConfiguration {
    return this.config;
  }

  public async isDaemonRunning(): Promise<boolean> {
    const port = this.config.daemonPort || 4203;
    const url = `http://127.0.0.1:${port}/api/v1/admin/dashboard`;
    return new Promise((resolve) => {
      const req = http.get(url, (res) => {
        resolve(res.statusCode !== 502 && res.statusCode !== 404);
      });
      req.on('error', () => resolve(false));
      req.setTimeout(400, () => {
        req.destroy();
        resolve(false);
      });
    });
  }

  public async resolveTargetBaseUrl(): Promise<string> {
    if (this.config.hybridMode) {
      const daemonOk = await this.isDaemonRunning();
      if (daemonOk) {
        return `http://127.0.0.1:${this.config.daemonPort || 4203}`;
      }
    }
    return this.config.serverUrl;
  }

  public async request<T = any>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT',
    apiPath: string,
    body?: any
  ): Promise<T> {
    const baseUrl = await this.resolveTargetBaseUrl();
    const token = this.config.apiKey;

    return new Promise<T>((resolve, reject) => {
      let url: URL;
      try {
        url = new URL(baseUrl.replace(/\/+$/, '') + apiPath);
      } catch (e: any) {
        return reject(new Error(`Invalid URL: ${baseUrl}${apiPath}`));
      }

      const isHttps = url.protocol === 'https:';
      const transport = isHttps ? https : http;
      const bodyStr = body !== undefined ? JSON.stringify(body) : undefined;

      const headers: Record<string, string> = {
        'Accept': 'application/json',
        'X-Sulcus-Machine-Id': SulcusClient.getMachineId()
      };

      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      if (bodyStr !== undefined) {
        headers['Content-Type'] = 'application/json';
        headers['Content-Length'] = String(Buffer.byteLength(bodyStr));
      }

      const options = {
        hostname: url.hostname,
        port: url.port ? parseInt(url.port, 10) : (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method,
        headers,
        timeout: 8000
      };

      const req = transport.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf-8');
          if (!res.statusCode || res.statusCode >= 400) {
            return reject(new Error(`HTTP ${res.statusCode}: ${raw.substring(0, 300)}`));
          }
          if (!raw || raw.trim() === '') {
            return resolve(null as any);
          }
          try {
            resolve(JSON.parse(raw));
          } catch {
            resolve(raw as any);
          }
        });
      });

      req.on('error', (e) => reject(e));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`Request timed out (${method} ${apiPath})`));
      });

      if (bodyStr !== undefined) {
        req.write(bodyStr);
      }
      req.end();
    });
  }

  // ── High-Level Endpoints ──────────────────────────────────────────────

  public async search(options: SearchOptions): Promise<SearchResult[]> {
    const payload = {
      query: options.query,
      context: options.context || '',
      limit: options.limit || this.config.autoRecallLimit || 10,
      namespace: options.namespace || this.config.namespace || 'default',
      min_heat: options.min_heat,
      memory_type: options.memory_type
    };

    const res = await this.request('POST', '/api/v1/agent/search', payload);
    if (!res) return [];
    if (Array.isArray(res)) return res;
    if (res.results && Array.isArray(res.results)) return res.results;
    if (res.items && Array.isArray(res.items)) return res.items;
    if (res.nodes && Array.isArray(res.nodes)) return res.nodes;
    return [];
  }

  public async getEntityContext(
    entityNames: string[],
    namespace?: string,
    limit: number = 3
  ): Promise<EntityContextResponse> {
    try {
      return await this.request<EntityContextResponse>('POST', '/api/v1/agent/entity-context', {
        entity_names: entityNames.slice(0, 10),
        namespace: namespace || this.config.namespace || 'default',
        limit
      });
    } catch {
      return { entities: [] };
    }
  }

  public async labelWithSIU(text: string, qualityOnly: boolean = false): Promise<SIULabelResponse> {
    try {
      const res = await this.request<SIULabelResponse>('POST', '/api/v2/siu/label', {
        text,
        quality_only: qualityOnly
      });
      return res || { quality: 'store', memory_type: 'semantic' };
    } catch {
      // If SIU endpoint is unavailable, default to storing as semantic
      return { quality: 'store', memory_type: 'semantic' };
    }
  }

  public async createNode(params: CreateMemoryParams): Promise<MemoryNode> {
    const payload = {
      label: params.label,
      memory_type: params.memory_type || 'semantic',
      is_pinned: params.is_pinned ?? false,
      decay_class: params.decay_class || 'normal',
      initial_heat: params.initial_heat,
      min_heat: params.min_heat,
      namespace: params.namespace || this.config.namespace || 'default',
      tags: params.tags,
      metadata: params.metadata
    };
    return await this.request<MemoryNode>('POST', '/api/v1/agent/nodes', payload);
  }

  public async getNode(id: string): Promise<MemoryNode> {
    return await this.request<MemoryNode>('GET', `/api/v1/agent/nodes/${id}`);
  }

  public async patchNode(id: string, updates: Partial<CreateMemoryParams>): Promise<MemoryNode> {
    return await this.request<MemoryNode>('PATCH', `/api/v1/agent/nodes/${id}`, updates);
  }

  public async deleteNode(id: string): Promise<boolean> {
    try {
      await this.request('DELETE', `/api/v1/agent/nodes/${id}`);
      return true;
    } catch {
      return false;
    }
  }

  public async listNodes(namespace?: string, limit: number = 50, offset: number = 0): Promise<MemoryNode[]> {
    const res = await this.listNodesPaginated(namespace, limit, offset);
    return res.items;
  }

  public async listNodesPaginated(
    namespace?: string,
    limit: number = 50,
    offset: number = 0,
    search?: string,
    memoryType?: string
  ): Promise<{ items: MemoryNode[]; total: number; page: number; pageSize: number }> {
    const ns = namespace || this.config.namespace || 'default';
    const params = new URLSearchParams();
    if (ns && ns !== 'all' && ns !== '*') {
      params.set('namespace', ns);
    }
    params.set('limit', String(limit));
    params.set('page_size', String(limit));
    params.set('offset', String(offset));
    params.set('page', String(Math.floor(offset / limit) + 1));
    if (search) params.set('search', search);
    if (memoryType && memoryType !== 'all') params.set('memory_type', memoryType);

    try {
      const res = await this.request('GET', `/api/v1/agent/nodes?${params.toString()}`);
      if (!res) return { items: [], total: 0, page: 1, pageSize: limit };
      if (Array.isArray(res)) return { items: res, total: res.length, page: 1, pageSize: limit };
      const items = res.items || res.nodes || [];
      const total = typeof res.total === 'number' ? res.total : items.length;
      return {
        items,
        total,
        page: res.page || 1,
        pageSize: res.page_size || limit
      };
    } catch {
      return { items: [], total: 0, page: 1, pageSize: limit };
    }
  }

  public async listNamespaces(): Promise<string[]> {
    try {
      const stats = await this.getDashboardStats();
      if (stats && stats.namespace_counts && Array.isArray(stats.namespace_counts)) {
        return stats.namespace_counts.map((n: any) => n.namespace).filter(Boolean);
      }
    } catch {}
    return ['default'];
  }

  public async getLedger(namespace?: string, limit: number = 20): Promise<any[]> {
    try {
      const ns = namespace || this.config.namespace || 'default';
      const res = await this.request('GET', `/api/v1/agent/ledger?namespace=${encodeURIComponent(ns)}&limit=${limit}`);
      if (Array.isArray(res)) return res;
      if (res && res.entries && Array.isArray(res.entries)) return res.entries;
      return [];
    } catch {
      return [];
    }
  }

  public async undoTurn(namespace?: string, count: number = 1): Promise<any> {
    const ns = namespace || this.config.namespace || 'default';
    return await this.request('POST', '/api/v1/agent/ledger/undo', {
      namespace: ns,
      session_id: `vscode-${process.pid}`,
      last_n: count
    });
  }

  public async recordLedger(body: any): Promise<any> {
    return await this.request('POST', '/api/v1/agent/ledger/record', body);
  }

  public async getHotNodes(namespace?: string, limit: number = 20): Promise<MemoryNode[]> {
    const ns = namespace || this.config.namespace || 'default';
    const res = await this.request('GET', `/api/v1/agent/hot_nodes?namespace=${encodeURIComponent(ns)}&limit=${limit}`);
    if (!res) return [];
    if (Array.isArray(res)) return res;
    if (res.nodes && Array.isArray(res.nodes)) return res.nodes;
    if (res.items && Array.isArray(res.items)) return res.items;
    return [];
  }

  public async sendFeedback(params: FeedbackParams): Promise<boolean> {
    try {
      await this.request('POST', '/api/v1/feedback', params);
      return true;
    } catch {
      return false;
    }
  }

  public async getDashboardStats(): Promise<DashboardStats> {
    return await this.request<DashboardStats>('GET', '/api/v1/admin/dashboard');
  }

  public async getGraphVisualization(namespace?: string): Promise<{ nodes: any[]; edges: any[] }> {
    const ns = namespace || this.config.namespace;
    const query = ns && ns !== 'all' ? `?namespace=${encodeURIComponent(ns)}` : '';
    const res = await this.request<any>('GET', `/api/v1/admin/visualize/graph${query}`);
    return res || { nodes: [], edges: [] };
  }
}
