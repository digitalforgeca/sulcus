import * as vscode from 'vscode';
import { SulcusClient } from '../api/sulcusClient';
import { MemoryPreviewProvider } from '../services/memoryPreviewProvider';
import { MemoryNode } from '../types';
import { cleanMemoryLabel } from '../utils/format';

export class MemoryMapPanel {
  public static currentPanel: MemoryMapPanel | undefined;
  public static readonly viewType = 'sulcus.memoryMap';

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private readonly _client: SulcusClient;
  private readonly _previewProvider: MemoryPreviewProvider;
  private _disposables: vscode.Disposable[] = [];

  public static createOrShow(
    extensionUri: vscode.Uri,
    client: SulcusClient,
    previewProvider: MemoryPreviewProvider
  ) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (MemoryMapPanel.currentPanel) {
      MemoryMapPanel.currentPanel._panel.reveal(column);
      MemoryMapPanel.currentPanel.refresh();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      MemoryMapPanel.viewType,
      'Memory Map',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [extensionUri]
      }
    );

    MemoryMapPanel.currentPanel = new MemoryMapPanel(panel, extensionUri, client, previewProvider);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    client: SulcusClient,
    previewProvider: MemoryPreviewProvider
  ) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._client = client;
    this._previewProvider = previewProvider;

    this._panel.webview.html = this._getHtmlForWebview();

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.command) {
          case 'openDetail':
            if (message.node) {
              const node: MemoryNode = message.node;
              this._previewProvider.cacheNode(node);
              const cleanId = node.id.replace(/\.md$/i, '');
              const uri = vscode.Uri.parse(`${MemoryPreviewProvider.scheme}:///${cleanId}.md`);
              const doc = await vscode.workspace.openTextDocument(uri);
              await vscode.window.showTextDocument(doc, { preview: true, preserveFocus: false });
            }
            break;
          case 'boost':
            if (message.id) {
              await this._client.sendFeedback({ node_id: message.id, feedback_type: 'boost', strength: 0.15 });
              vscode.window.showInformationMessage('Boosted Memory Heat');
              await this.refresh();
            }
            break;
          case 'pin':
            if (message.id) {
              await this._client.patchNode(message.id, {
                is_pinned: message.isPinned,
                decay_class: message.isPinned ? 'glacial' : 'normal'
              });
              vscode.window.showInformationMessage('Updated Memory Pin');
              await this.refresh();
            }
            break;
          case 'copy':
            if (message.text) {
              await vscode.env.clipboard.writeText(message.text);
              vscode.window.showInformationMessage('Copied To Clipboard');
            }
            break;
          case 'refresh':
            await this.refresh();
            break;
        }
      },
      null,
      this._disposables
    );

    // Initial graph load
    this.refresh();
  }

  public async refresh() {
    try {
      const config = this._client.getConfig();
      let rawData: { nodes: any[]; edges: any[] } = { nodes: [], edges: [] };
      try {
        rawData = await this._client.getGraphVisualization(config.namespace);
      } catch {
        const paginated = await this._client.listNodesPaginated(config.namespace, 250, 0);
        rawData = {
          nodes: paginated.items,
          edges: []
        };
      }

      // Pre-clean labels on nodes
      const cleanedNodes = (rawData.nodes || []).map((n: any) => ({
        ...n,
        label: cleanMemoryLabel(n.label, n.pointer_summary),
        rawLabel: n.label,
        pointer_summary: n.pointer_summary || n.label || ''
      }));

      this._panel.webview.postMessage({
        command: 'setData',
        payload: {
          nodes: cleanedNodes,
          edges: rawData.edges || [],
          namespace: config.namespace || 'default',
          mode: (config.serverUrl.includes('127.0.0.1') || config.serverUrl.includes('localhost')) ? 'Local' : 'Cloud'
        }
      });
    } catch {
      vscode.window.showErrorMessage('Graph Load Failed');
    }
  }

  public dispose() {
    MemoryMapPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) x.dispose();
    }
  }

  private _getHtmlForWebview(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Memory Map</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      user-select: none;
    }
    body {
      background: #090d13;
      color: var(--vscode-editor-foreground, #cccccc);
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
      overflow: hidden;
      width: 100vw;
      height: 100vh;
      display: flex;
      flex-direction: column;
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 8px 16px;
      background: #0d121a;
      border-bottom: 1px solid rgba(0, 240, 255, 0.15);
      z-index: 10;
      flex-wrap: wrap;
    }
    .header-left {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .brand {
      font-weight: 700;
      font-size: 13px;
      letter-spacing: 0.5px;
      color: #00F0FF;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .stats-group {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .stat-badge {
      font-size: 11px;
      padding: 2px 8px;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 4px;
      display: inline-flex;
      gap: 4px;
    }
    .stat-badge b {
      color: #00F0FF;
    }
    .header-center {
      display: flex;
      align-items: center;
      gap: 12px;
      flex: 1;
      min-width: 0;
    }
    .search-box {
      width: 210px;
      flex-shrink: 0;
      position: relative;
      display: flex;
      align-items: center;
    }
    .search-box svg {
      position: absolute;
      left: 8px;
      width: 14px;
      height: 14px;
      color: var(--vscode-input-placeholderForeground, #888);
      pointer-events: none;
    }
    .search-box input {
      width: 100%;
      padding: 4px 8px 4px 28px;
      background: #141b24;
      color: #fff;
      border: 1px solid rgba(0, 240, 255, 0.2);
      border-radius: 4px;
      font-size: 12px;
      outline: none;
    }
    .search-box input:focus {
      border-color: #00F0FF;
    }
    .match-counter {
      position: absolute;
      right: 8px;
      font-size: 10px;
      color: #00F0FF;
      font-weight: 600;
    }
    .filter-chips {
      display: flex;
      align-items: center;
      gap: 5px;
      overflow-x: auto;
      min-width: 0;
      flex-shrink: 1;
    }
    .chip {
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.12);
      color: #aaa;
      cursor: pointer;
      white-space: nowrap;
      transition: all 0.15s ease;
    }
    .chip:hover {
      background: rgba(255, 255, 255, 0.12);
      color: #fff;
    }
    .chip.active {
      background: rgba(0, 240, 255, 0.18);
      border-color: #00F0FF;
      color: #00F0FF;
      font-weight: 600;
    }
    .header-right {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 4px 10px;
      font-size: 11px;
      font-weight: 500;
      color: var(--vscode-button-foreground, #fff);
      background: var(--vscode-button-secondaryBackground, #1e2632);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 4px;
      cursor: pointer;
      transition: background 0.15s ease;
    }
    .btn.icon-btn {
      padding: 5px 8px;
      min-width: 28px;
      justify-content: center;
    }
    .btn:hover {
      background: #2b3545;
    }
    .btn.primary {
      background: #007acc;
    }
    .btn.primary:hover {
      background: #0062a3;
    }
    .btn svg {
      width: 13px;
      height: 13px;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    #viewport {
      position: relative;
      flex: 1;
      width: 100%;
      height: 100%;
      overflow: hidden;
    }
    canvas {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      cursor: grab;
    }
    canvas.dragging {
      cursor: grabbing;
    }
    /* Inspector Drawer */
    #drawer {
      position: absolute;
      top: 16px;
      right: 16px;
      width: 340px;
      max-height: calc(100% - 32px);
      background: rgba(13, 18, 26, 0.95);
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
      border: 1px solid rgba(0, 240, 255, 0.35);
      border-radius: 8px;
      box-shadow: 0 16px 40px rgba(0, 0, 0, 0.7);
      display: flex;
      flex-direction: column;
      z-index: 20;
      transform: translateX(380px);
      transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1);
    }
    #drawer.open {
      transform: translateX(0);
    }
    .drawer-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 14px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    }
    .drawer-title {
      font-size: 13px;
      font-weight: 600;
      color: #fff;
    }
    .drawer-body {
      padding: 14px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .badge-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .type-pill {
      font-size: 10px;
      text-transform: uppercase;
      font-weight: 700;
      letter-spacing: 0.5px;
      padding: 2px 8px;
      border-radius: 10px;
      background: rgba(255, 255, 255, 0.1);
      color: #fff;
    }
    .heat-container {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .heat-label {
      font-size: 11px;
      color: #888;
      display: flex;
      justify-content: space-between;
    }
    .heat-track {
      height: 6px;
      background: rgba(255, 255, 255, 0.08);
      border-radius: 3px;
      overflow: hidden;
    }
    .heat-fill {
      height: 100%;
      background: linear-gradient(90deg, #8B5CF6, #00F0FF, #f59e0b, #ef4444);
      width: 0%;
      transition: width 0.3s ease;
    }
    .node-text {
      font-size: 12px;
      line-height: 1.5;
      color: #e0e0e0;
      background: rgba(0, 0, 0, 0.35);
      padding: 12px;
      border-radius: 6px;
      border: 1px solid rgba(0, 240, 255, 0.15);
      max-height: 220px;
      overflow-y: auto;
      user-select: text;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .drawer-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      padding-top: 6px;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
    }
    /* Tooltip */
    #tooltip {
      position: absolute;
      pointer-events: none;
      background: rgba(10, 15, 22, 0.95);
      border: 1px solid rgba(0, 240, 255, 0.4);
      border-radius: 4px;
      padding: 6px 10px;
      font-size: 11px;
      color: #fff;
      z-index: 30;
      opacity: 0;
      transition: opacity 0.15s ease;
      max-width: 280px;
      word-break: break-word;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
    }
  </style>
</head>
<body>

  <header>
    <div class="header-left">
      <div class="brand" title="Memory Visualizer">
        <svg width="16" height="16" viewBox="0 0 512 512" fill="none">
          <polygon points="256,72 328,144 256,216 184,144" stroke="#00F0FF" stroke-width="24" fill="none"></polygon>
          <polygon points="368,184 440,256 368,328 296,256" stroke="#00F0FF" stroke-width="24" fill="none"></polygon>
          <polygon points="256,296 328,368 256,440 184,368" stroke="#00F0FF" stroke-width="24" fill="none"></polygon>
          <polygon points="144,184 216,256 144,328 72,256" stroke="#00F0FF" stroke-width="24" fill="none"></polygon>
        </svg>
        Memory Map
      </div>
      <div class="stats-group">
        <div class="stat-badge" title="Engine Version">Engine <b>3</b></div>
        <div class="stat-badge" title="Storage Mode">Mode <b id="statMode">Local</b></div>
        <div class="stat-badge" title="Recorded Nodes">Nodes <b id="statNodes">0</b></div>
        <div class="stat-badge" title="Knowledge Edges">Edges <b id="statEdges">0</b></div>
        <div class="stat-badge" title="Active Namespace">Namespace <b id="statNs">default</b></div>
      </div>
    </div>

    <div class="header-center">
      <div class="search-box">
        <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
        <input type="text" id="searchInput" placeholder="Search Memories" title="Search Memory Nodes" />
        <span class="match-counter" id="matchCounter" title="Matched Memory Count"></span>
      </div>
      <div class="filter-chips">
        <div class="chip active" data-type="all" title="All Memory Types">All Types</div>
        <div class="chip" data-type="fact" title="Fact Memories">Fact</div>
        <div class="chip" data-type="procedural" title="Procedural Memories">Procedural</div>
        <div class="chip" data-type="preference" title="Preference Memories">Preference</div>
        <div class="chip" data-type="semantic" title="Semantic Memories">Semantic</div>
        <div class="chip" data-type="episodic" title="Episodic Memories">Episodic</div>
        <div class="chip" data-type="synthesis" title="Synthesis Memories">Synthesis</div>
      </div>
    </div>

    <div class="header-right">
      <button class="btn icon-btn" id="btnTourPrev" title="Previous Match" style="display:none;">
        <svg viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"></polyline></svg>
      </button>
      <button class="btn icon-btn" id="btnTourNext" title="Next Match" style="display:none;">
        <svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"></polyline></svg>
      </button>
      <button class="btn icon-btn" id="btnZoomIn" title="Zoom In">
        <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"></circle><line x1="11" y1="8" x2="11" y2="14"></line><line x1="8" y1="11" x2="14" y2="11"></line><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
      </button>
      <button class="btn icon-btn" id="btnZoomOut" title="Zoom Out">
        <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"></circle><line x1="8" y1="11" x2="14" y2="11"></line><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
      </button>
      <button class="btn icon-btn" id="btnReset" title="Reset View">
        <svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path></svg>
      </button>
      <button class="btn icon-btn primary" id="btnRefresh" title="Refresh Graph">
        <svg viewBox="0 0 24 24"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.19"></path></svg>
      </button>
    </div>
  </header>

  <div id="viewport">
    <canvas id="graphCanvas"></canvas>

    <div id="drawer">
      <div class="drawer-header">
        <span class="drawer-title" title="Memory Inspector Drawer">Memory Inspector</span>
        <button class="btn" id="btnCloseDrawer" title="Close Drawer">
          <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          Close
        </button>
      </div>
      <div class="drawer-body">
        <div class="badge-row">
          <span class="type-pill" id="drawerType" title="Memory Classification">fact</span>
          <span class="stat-badge" id="drawerPinStatus" title="Pin Classification">Unpinned Normal</span>
        </div>
        <div class="heat-container" title="Thermodynamic Heat Level">
          <div class="heat-label">
            <span>Memory Heat</span>
            <span id="drawerHeatText">85%</span>
          </div>
          <div class="heat-track">
            <div class="heat-fill" id="drawerHeatBar"></div>
          </div>
        </div>
        <div class="node-text" id="drawerContent" title="Memory Content Preview"></div>
        <div class="drawer-actions">
          <button class="btn primary" id="btnInspectDoc" title="Inspect Memory Document">
            <svg viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
            Inspect
          </button>
          <button class="btn" id="btnBoostNode" title="Boost Memory Heat">
            <svg viewBox="0 0 24 24"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"></path></svg>
            Boost
          </button>
          <button class="btn" id="btnPinNode" title="Toggle Memory Pin">
            <svg viewBox="0 0 24 24"><line x1="12" y1="17" x2="12" y2="22"></line><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.89A2 2 0 0 1 15 10.77V6h1a1 1 0 0 0 0-2H8a1 1 0 0 0 0 2h1v4.77a2 2 0 0 1-1.11 1.79l-1.78.89A2 2 0 0 0 5 15.24Z"></path></svg>
            Pin
          </button>
          <button class="btn" id="btnCopyNode" title="Copy Memory Content">
            <svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            Copy
          </button>
        </div>
      </div>
    </div>

    <div id="tooltip"></div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    const TYPE_COLORS = {
      preference: '#D4AF37', // Gold
      fact: '#22c55e',       // Emerald
      procedural: '#8B5CF6', // Purple
      semantic: '#00F0FF',   // Cyan
      episodic: '#f59e0b',   // Amber
      synthesis: '#EC4899',  // Pink
      core_identity: '#FFFFFF'
    };

    const canvas = document.getElementById('graphCanvas');
    const ctx = canvas.getContext('2d');
    const viewport = document.getElementById('viewport');
    const drawer = document.getElementById('drawer');
    const tooltip = document.getElementById('tooltip');

    let allNodes = [];
    let allEdges = [];
    let visibleNodes = [];
    let visibleEdges = [];
    let activeType = 'all';
    let searchQuery = '';
    let selectedNode = null;
    let hoveredNode = null;
    let draggedNode = null;
    let searchMatches = [];
    let searchIndex = 0;

    let transform = { x: 0, y: 0, scale: 1 };
    let isPanning = false;
    let panStart = { x: 0, y: 0 };
    let animationFrame = null;
    let isSimulating = true;

    function resizeCanvas() {
      const dpr = window.devicePixelRatio || 1;
      const rect = viewport.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw();
    }
    window.addEventListener('resize', resizeCanvas);

    // Strips type prefix and falls back to summary if label is trivial
    function cleanLabel(raw, summary) {
      let text = (raw || '').trim();
      const lower = text.toLowerCase();
      if ((lower.startsWith('synthesis:') && text.length < 25) || !text) {
        if (summary && summary.trim()) text = summary.trim();
      }
      text = text.replace(/^(synthesis|fact|procedural|preference|semantic|episodic|core(\s*identity)?)\s*:\s*/i, '').trim();
      const lowerAfter = text.toLowerCase();
      if ((lowerAfter === 'oo' || lowerAfter === 'default' || lowerAfter === 'sulcus' || text.length < 4) && summary && summary.trim()) {
        let cleanSum = summary.trim().replace(/^(synthesis|fact|procedural|preference|semantic|episodic|core(\s*identity)?)\s*:\s*/i, '').trim();
        if (cleanSum) text = cleanSum;
      }
      return text || raw || summary || 'Memory';
    }

    function processConstellationTopology(nodes, edges) {
      // 1. Group by (namespace, memory_type)
      const groups = {};
      for (const n of nodes) {
        n.label = cleanLabel(n.label, n.pointer_summary);
        const key = (n.namespace || 'default') + '::' + (n.memory_type || 'episodic');
        if (!groups[key]) groups[key] = [];
        groups[key].push(n);
      }

      // 2. Elect Constellation Hubs (hottest node in each cluster)
      const hubIds = new Set();
      const groupList = Object.values(groups);
      for (const grp of groupList) {
        grp.sort((a, b) => (b.current_heat || 0) - (a.current_heat || 0));
        if (grp.length > 0) {
          grp[0].isHub = true;
          hubIds.add(grp[0].id);
        }
      }

      // 3. Connect unlinked members to their group Hub
      const connected = new Set();
      const synthesizedEdges = [...edges];
      for (const e of edges) {
        connected.add(e.source);
        connected.add(e.target);
      }

      for (const grp of groupList) {
        if (grp.length < 2) continue;
        const hub = grp[0];
        for (let i = 1; i < grp.length; i++) {
          const member = grp[i];
          if (!connected.has(member.id)) {
            synthesizedEdges.push({
              source: hub.id,
              target: member.id,
              weight: 0.2,
              type: 'constellation'
            });
            connected.add(member.id);
          }
        }
      }

      // 4. Connect visible Hubs in a backbone ring
      const hubs = Array.from(hubIds);
      if (hubs.length > 1) {
        for (let i = 0; i < hubs.length - 1; i++) {
          synthesizedEdges.push({
            source: hubs[i],
            target: hubs[i + 1],
            weight: 0.15,
            type: 'constellation_backbone'
          });
        }
      }

      return { processedNodes: nodes, processedEdges: synthesizedEdges };
    }

    function filterGraph() {
      const q = searchQuery.toLowerCase().trim();
      visibleNodes = allNodes.filter(n => {
        if (activeType !== 'all' && n.memory_type !== activeType) return false;
        if (q && !n.label.toLowerCase().includes(q) && !(n.pointer_summary || '').toLowerCase().includes(q)) return false;
        return true;
      });

      // Limit simulated nodes for smooth 60fps
      if (visibleNodes.length > 250) {
        visibleNodes.sort((a, b) => {
          if (a.isHub && !b.isHub) return -1;
          if (!a.isHub && b.isHub) return 1;
          return (b.current_heat || 0) - (a.current_heat || 0);
        });
        visibleNodes = visibleNodes.slice(0, 250);
      }

      const nodeMap = new Set(visibleNodes.map(n => n.id));
      visibleEdges = allEdges.filter(e => nodeMap.has(e.source) && nodeMap.has(e.target));

      // Search matches
      if (q) {
        searchMatches = visibleNodes.filter(n =>
          n.label.toLowerCase().includes(q) || (n.pointer_summary || '').toLowerCase().includes(q)
        );
        document.getElementById('matchCounter').textContent = searchMatches.length + ' Matches';
        document.getElementById('btnTourPrev').style.display = searchMatches.length > 0 ? 'inline-flex' : 'none';
        document.getElementById('btnTourNext').style.display = searchMatches.length > 0 ? 'inline-flex' : 'none';
      } else {
        searchMatches = [];
        document.getElementById('matchCounter').textContent = '';
        document.getElementById('btnTourPrev').style.display = 'none';
        document.getElementById('btnTourNext').style.display = 'none';
      }

      document.getElementById('statNodes').textContent = allNodes.length;
      document.getElementById('statEdges').textContent = allEdges.length;

      isSimulating = true;
      startLoop();
    }

    function stepPhysics() {
      if (!isSimulating) return;

      const kCenter = 0.0006;
      const kRepulsion = 750;
      const kSpring = 0.035;
      const width = viewport.clientWidth;
      const height = viewport.clientHeight;
      const cx = width / 2;
      const cy = height / 2;

      let totalVelocity = 0;

      for (let i = 0; i < visibleNodes.length; i++) {
        const n1 = visibleNodes[i];
        if (n1 === draggedNode) continue;

        let fx = (cx - n1.x) * kCenter;
        let fy = (cy - n1.y) * kCenter;

        for (let j = i + 1; j < visibleNodes.length; j++) {
          const n2 = visibleNodes[j];
          const dx = n2.x - n1.x;
          const dy = n2.y - n1.y;
          const distSq = dx * dx + dy * dy + 0.1;
          const dist = Math.sqrt(distSq);
          if (dist < 280) {
            const force = kRepulsion / distSq;
            const fxRep = (dx / dist) * force;
            const fyRep = (dy / dist) * force;
            fx -= fxRep;
            fy -= fyRep;
            if (n2 !== draggedNode) {
              n2.vx += fxRep;
              n2.vy += fyRep;
            }
          }
        }

        n1.vx = (n1.vx + fx) * 0.84;
        n1.vy = (n1.vy + fy) * 0.84;
        n1.x += n1.vx;
        n1.y += n1.vy;

        totalVelocity += Math.abs(n1.vx) + Math.abs(n1.vy);
      }

      // Edge spring forces
      for (const e of visibleEdges) {
        const src = visibleNodes.find(n => n.id === e.source);
        const tgt = visibleNodes.find(n => n.id === e.target);
        if (!src || !tgt) continue;

        const dx = tgt.x - src.x;
        const dy = tgt.y - src.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const desiredLength = e.type === 'constellation' ? 65 : (e.type === 'constellation_backbone' ? 140 : 80);
        const displacement = dist - desiredLength;
        const force = displacement * kSpring * (e.weight || 0.4);

        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;

        if (src !== draggedNode) {
          src.vx += fx;
          src.vy += fy;
        }
        if (tgt !== draggedNode) {
          tgt.vx -= fx;
          tgt.vy -= fy;
        }
      }

      if (totalVelocity < 0.04 && !draggedNode) {
        isSimulating = false;
      }
    }

    function draw() {
      const width = viewport.clientWidth;
      const height = viewport.clientHeight;
      ctx.clearRect(0, 0, width, height);

      // Coordinate Grid Lines (Celestial Matrix)
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.025)';
      ctx.lineWidth = 1;
      const gridSize = 40;
      const startX = (transform.x % gridSize);
      const startY = (transform.y % gridSize);
      for (let gx = startX; gx < width; gx += gridSize) {
        ctx.beginPath();
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx, height);
        ctx.stroke();
      }
      for (let gy = startY; gy < height; gy += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.lineTo(width, gy);
        ctx.stroke();
      }

      ctx.save();
      ctx.translate(transform.x, transform.y);
      ctx.scale(transform.scale, transform.scale);

      const activeNeighbors = new Set();
      if (selectedNode) {
        activeNeighbors.add(selectedNode.id);
        for (const e of visibleEdges) {
          if (e.source === selectedNode.id) activeNeighbors.add(e.target);
          if (e.target === selectedNode.id) activeNeighbors.add(e.source);
        }
      }

      // ── Edges ──
      for (const e of visibleEdges) {
        const src = visibleNodes.find(n => n.id === e.source);
        const tgt = visibleNodes.find(n => n.id === e.target);
        if (!src || !tgt) continue;

        const isConnected = selectedNode && (selectedNode.id === src.id || selectedNode.id === tgt.id);
        const isHoverConnected = hoveredNode && (hoveredNode.id === src.id || hoveredNode.id === tgt.id);

        ctx.beginPath();
        ctx.moveTo(src.x, src.y);
        ctx.lineTo(tgt.x, tgt.y);

        if (isConnected || isHoverConnected) {
          ctx.strokeStyle = '#00F0FF';
          ctx.lineWidth = 2 / transform.scale;
          ctx.globalAlpha = 0.95;
        } else if (e.type === 'constellation') {
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
          ctx.lineWidth = 0.8 / transform.scale;
          ctx.globalAlpha = 0.3;
        } else if (e.type === 'constellation_backbone') {
          ctx.strokeStyle = 'rgba(212, 175, 55, 0.18)';
          ctx.lineWidth = 1.2 / transform.scale;
          ctx.globalAlpha = 0.4;
        } else {
          ctx.strokeStyle = 'rgba(0, 240, 255, 0.25)';
          ctx.lineWidth = 1 / transform.scale;
          ctx.globalAlpha = 0.45;
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1.0;

      // ── Nodes ──
      for (const node of visibleNodes) {
        const heat = node.current_heat || 0;
        const baseColor = TYPE_COLORS[node.memory_type] || '#00F0FF';
        const isSel = selectedNode && selectedNode.id === node.id;
        const isHov = hoveredNode && hoveredNode.id === node.id;
        const isMatch = searchMatches.some(m => m.id === node.id);
        const isNeighbor = activeNeighbors.has(node.id);

        const radius = Math.max(5, Math.min(18, (node.isHub ? 7 : 5) + heat * 9));

        // 1. Search Match Beacon Ring
        if (isMatch) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, radius + 8 / Math.max(0.6, transform.scale * 0.5), 0, Math.PI * 2);
          ctx.strokeStyle = '#00F0FF';
          ctx.lineWidth = 2 / transform.scale;
          ctx.stroke();
        }

        // 2. Radiant Heat Halo for hot or focused nodes
        if (heat > 0.55 || isSel || isHov || node.isHub) {
          const glowRadius = radius + (isSel ? 10 : (node.isHub ? 6 : 4)) * (heat || 0.6);
          const grad = ctx.createRadialGradient(node.x, node.y, radius * 0.3, node.x, node.y, glowRadius);
          grad.addColorStop(0, isSel ? 'rgba(0, 240, 255, 0.6)' : (node.isHub ? 'rgba(212, 175, 55, 0.5)' : baseColor));
          grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(node.x, node.y, glowRadius, 0, Math.PI * 2);
          ctx.fill();
        }

        // 3. Pinned Diamond Ring
        if (node.is_pinned) {
          ctx.beginPath();
          const dSize = radius + 5;
          ctx.moveTo(node.x, node.y - dSize);
          ctx.lineTo(node.x + dSize, node.y);
          ctx.lineTo(node.x, node.y + dSize);
          ctx.lineTo(node.x - dSize, node.y);
          ctx.closePath();
          ctx.strokeStyle = '#00F0FF';
          ctx.lineWidth = 1.8 / transform.scale;
          ctx.stroke();
        }

        // 4. Hub Ring
        if (node.isHub) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, radius + 3, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(212, 175, 55, 0.85)';
          ctx.lineWidth = 1.5 / transform.scale;
          ctx.stroke();
        }

        // 5. Core Circle
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = baseColor;
        ctx.fill();

        ctx.strokeStyle = isSel ? '#FFFFFF' : 'rgba(0, 0, 0, 0.6)';
        ctx.lineWidth = (isSel ? 2.5 : 1.2) / transform.scale;
        ctx.stroke();

        // 6. Level of Detail (LOD) Pill Label Rendering
        // Only render labels for: Focused, Hovered, Search Match, Constellation Hubs, or when zoomed in
        const shouldDrawLabel =
          isSel ||
          isHov ||
          isMatch ||
          (node.isHub && transform.scale > 0.75) ||
          (isNeighbor && transform.scale > 1.1) ||
          transform.scale > 2.2;

        if (shouldDrawLabel && node.label) {
          const rawText = node.label.length > 44 ? node.label.slice(0, 42) + '…' : node.label;
          const fontSize = Math.max(9, Math.min(13, 11 / transform.scale));
          ctx.font = '600 ' + fontSize + 'px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

          const textWidth = ctx.measureText(rawText).width;
          const padX = 6 / transform.scale;
          const padY = 3 / transform.scale;
          const pillX = node.x + radius + 4 / transform.scale;
          const pillY = node.y - fontSize / 2 - padY;
          const pillW = textWidth + padX * 2;
          const pillH = fontSize + padY * 2;
          const corner = 3 / transform.scale;

          ctx.fillStyle = isSel
            ? '#00F0FF'
            : (isMatch ? 'rgba(0, 240, 255, 0.9)' : (node.isHub ? 'rgba(212, 175, 55, 0.9)' : 'rgba(10, 16, 24, 0.88)'));
          ctx.beginPath();
          if (ctx.roundRect) {
            ctx.roundRect(pillX, pillY, pillW, pillH, corner);
          } else {
            ctx.rect(pillX, pillY, pillW, pillH);
          }
          ctx.fill();

          if (!isSel && !isMatch && !node.isHub) {
            ctx.lineWidth = 1 / transform.scale;
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
            ctx.stroke();
          }

          ctx.fillStyle = (isSel || isMatch || node.isHub) ? '#050A0F' : '#EDEDED';
          ctx.textBaseline = 'middle';
          ctx.fillText(rawText, pillX + padX, node.y);
          node.__labelBox = { x: pillX, y: pillY, w: pillW, h: pillH };
        } else {
          node.__labelBox = null;
        }
      }

      ctx.restore();
    }

    function startLoop() {
      if (animationFrame) cancelAnimationFrame(animationFrame);
      function loop() {
        stepPhysics();
        draw();
        if (isSimulating || draggedNode) {
          animationFrame = requestAnimationFrame(loop);
        }
      }
      animationFrame = requestAnimationFrame(loop);
    }

    function toGraphCoord(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      const x = (clientX - rect.left - transform.x) / transform.scale;
      const y = (clientY - rect.top - transform.y) / transform.scale;
      return { x, y };
    }

    function getNodeAt(x, y) {
      for (let i = visibleNodes.length - 1; i >= 0; i--) {
        const n = visibleNodes[i];
        const r = Math.max(8, 8 + (n.current_heat || 0) * 10) + 4;
        const dx = n.x - x;
        const dy = n.y - y;
        if (dx * dx + dy * dy <= r * r) {
          return n;
        }
        if (n.__labelBox) {
          const b = n.__labelBox;
          if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
            return n;
          }
        }
      }
      return null;
    }

    function flyToNode(node, zoomLevel = 1.8) {
      if (!node) return;
      const targetScale = Math.min(4.0, Math.max(0.8, zoomLevel));
      const targetX = viewport.clientWidth / 2 - node.x * targetScale;
      const targetY = viewport.clientHeight / 2 - node.y * targetScale;

      const startX = transform.x;
      const startY = transform.y;
      const startScale = transform.scale;
      const startTime = performance.now();
      const duration = 400;

      function step(now) {
        const elapsed = now - startTime;
        const progress = Math.min(1, elapsed / duration);
        const ease = 1 - Math.pow(1 - progress, 3);

        transform.x = startX + (targetX - startX) * ease;
        transform.y = startY + (targetY - startY) * ease;
        transform.scale = startScale + (targetScale - startScale) * ease;
        draw();

        if (progress < 1) {
          requestAnimationFrame(step);
        }
      }
      requestAnimationFrame(step);
    }

    // Canvas Mouse Events
    canvas.addEventListener('mousedown', (e) => {
      const pos = toGraphCoord(e.clientX, e.clientY);
      const clicked = getNodeAt(pos.x, pos.y);

      if (clicked) {
        draggedNode = clicked;
        selectedNode = clicked;
        openDrawer(clicked);
        isSimulating = true;
        startLoop();
      } else {
        isPanning = true;
        panStart = { x: e.clientX - transform.x, y: e.clientY - transform.y };
        canvas.classList.add('dragging');
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (draggedNode) {
        const pos = toGraphCoord(e.clientX, e.clientY);
        draggedNode.x = pos.x;
        draggedNode.y = pos.y;
        draggedNode.vx = 0;
        draggedNode.vy = 0;
        draw();
        return;
      }

      if (isPanning) {
        transform.x = e.clientX - panStart.x;
        transform.y = e.clientY - panStart.y;
        draw();
        return;
      }

      // Hover check
      const pos = toGraphCoord(e.clientX, e.clientY);
      const node = getNodeAt(pos.x, pos.y);

      if (node !== hoveredNode) {
        hoveredNode = node;
        draw();
      }

      if (node) {
        tooltip.style.opacity = '1';
        tooltip.style.left = (e.clientX + 14) + 'px';
        tooltip.style.top = (e.clientY + 14) + 'px';
        const heatPct = Math.round((node.current_heat || 0) * 100);
        tooltip.innerHTML = '<b>' + (node.memory_type || 'memory').toUpperCase() + '</b> (' + heatPct + '% heat)<br>' + node.label;
      } else {
        tooltip.style.opacity = '0';
      }
    });

    window.addEventListener('mouseup', () => {
      if (draggedNode) {
        draggedNode = null;
      }
      if (isPanning) {
        isPanning = false;
        canvas.classList.remove('dragging');
      }
    });

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const newScale = Math.max(0.15, Math.min(4.5, transform.scale * zoomFactor));
      transform.x = mouseX - (mouseX - transform.x) * (newScale / transform.scale);
      transform.y = mouseY - (mouseY - transform.y) * (newScale / transform.scale);
      transform.scale = newScale;
      draw();
    }, { passive: false });

    // Drawer Controls
    function openDrawer(node) {
      document.getElementById('drawerType').textContent = node.memory_type || 'memory';
      document.getElementById('drawerType').style.color = TYPE_COLORS[node.memory_type] || '#00F0FF';
      document.getElementById('drawerPinStatus').textContent = node.is_pinned ? 'Pinned Glacial' : 'Unpinned Normal';
      const heat = Math.round((node.current_heat || 0) * 100);
      document.getElementById('drawerHeatText').textContent = heat + '%';
      document.getElementById('drawerHeatBar').style.width = heat + '%';
      
      const fullText = (node.pointer_summary && node.pointer_summary.length > node.label.length)
        ? node.pointer_summary
        : node.label;
      document.getElementById('drawerContent').textContent = fullText || 'No content';
      
      document.getElementById('btnPinNode').innerHTML = node.is_pinned
        ? '<svg viewBox="0 0 24 24"><line x1="12" y1="17" x2="12" y2="22"></line><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.89A2 2 0 0 1 15 10.77V6h1a1 1 0 0 0 0-2H8a1 1 0 0 0 0 2h1v4.77a2 2 0 0 1-1.11 1.79l-1.78.89A2 2 0 0 0 5 15.24Z"></path></svg> Unpin'
        : '<svg viewBox="0 0 24 24"><line x1="12" y1="17" x2="12" y2="22"></line><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.89A2 2 0 0 1 15 10.77V6h1a1 1 0 0 0 0-2H8a1 1 0 0 0 0 2h1v4.77a2 2 0 0 1-1.11 1.79l-1.78.89A2 2 0 0 0 5 15.24Z"></path></svg> Pin';
      document.getElementById('btnPinNode').title = node.is_pinned ? 'Unpin Memory' : 'Pin Memory';
      drawer.classList.add('open');
    }

    function closeDrawer() {
      drawer.classList.remove('open');
      selectedNode = null;
      draw();
    }
    document.getElementById('btnCloseDrawer').addEventListener('click', closeDrawer);

    // Inspector Action Buttons
    document.getElementById('btnInspectDoc').addEventListener('click', () => {
      if (selectedNode) {
        vscode.postMessage({ command: 'openDetail', node: selectedNode });
      }
    });

    document.getElementById('btnBoostNode').addEventListener('click', () => {
      if (selectedNode) {
        vscode.postMessage({ command: 'boost', id: selectedNode.id });
      }
    });

    document.getElementById('btnPinNode').addEventListener('click', () => {
      if (selectedNode) {
        vscode.postMessage({ command: 'pin', id: selectedNode.id, isPinned: !selectedNode.is_pinned });
      }
    });

    document.getElementById('btnCopyNode').addEventListener('click', () => {
      if (selectedNode) {
        const text = (selectedNode.pointer_summary && selectedNode.pointer_summary.length > selectedNode.label.length)
          ? selectedNode.pointer_summary
          : selectedNode.label;
        vscode.postMessage({ command: 'copy', text: text });
      }
    });

    // Header Toolbar Buttons
    document.getElementById('btnZoomIn').addEventListener('click', () => {
      transform.scale = Math.min(4.5, transform.scale * 1.3);
      draw();
    });

    document.getElementById('btnZoomOut').addEventListener('click', () => {
      transform.scale = Math.max(0.15, transform.scale * 0.7);
      draw();
    });

    document.getElementById('btnReset').addEventListener('click', () => {
      transform = { x: 0, y: 0, scale: 1 };
      draw();
    });

    document.getElementById('btnRefresh').addEventListener('click', () => {
      vscode.postMessage({ command: 'refresh' });
    });

    // Search Tour Stepper Buttons
    document.getElementById('btnTourPrev').addEventListener('click', () => {
      if (searchMatches.length === 0) return;
      searchIndex = (searchIndex - 1 + searchMatches.length) % searchMatches.length;
      const target = searchMatches[searchIndex];
      selectedNode = target;
      openDrawer(target);
      flyToNode(target, 2.0);
    });

    document.getElementById('btnTourNext').addEventListener('click', () => {
      if (searchMatches.length === 0) return;
      searchIndex = (searchIndex + 1) % searchMatches.length;
      const target = searchMatches[searchIndex];
      selectedNode = target;
      openDrawer(target);
      flyToNode(target, 2.0);
    });

    // Filter Chips
    document.querySelectorAll('.chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        activeType = chip.getAttribute('data-type');
        filterGraph();
      });
    });

    // Search Input
    document.getElementById('searchInput').addEventListener('input', (e) => {
      searchQuery = e.target.value;
      searchIndex = 0;
      filterGraph();
    });

    // Message handler from Extension Host
    window.addEventListener('message', (event) => {
      const message = event.data;
      if (message.command === 'setData') {
        const payload = message.payload;
        const rawNodes = payload.nodes || [];
        const rawEdges = payload.edges || [];

        const topology = processConstellationTopology(rawNodes, rawEdges);
        const processedNodes = topology.processedNodes;
        allEdges = topology.processedEdges;

        // Group into constellations for initial galaxy positioning
        const groups = {};
        for (const n of processedNodes) {
          const key = (n.namespace || 'default') + '::' + (n.memory_type || 'episodic');
          if (!groups[key]) groups[key] = [];
          groups[key].push(n);
        }

        const groupKeys = Object.keys(groups);
        const numGroups = groupKeys.length;
        const cx = viewport.clientWidth / 2;
        const cy = viewport.clientHeight / 2;
        const orbitRadius = Math.min(cx, cy) * 0.55;

        allNodes = [];
        groupKeys.forEach((key, gIdx) => {
          const grp = groups[key];
          const gAngle = (gIdx / Math.max(1, numGroups)) * Math.PI * 2;
          const hubX = cx + Math.cos(gAngle) * orbitRadius;
          const hubY = cy + Math.sin(gAngle) * orbitRadius;

          grp.forEach((n, mIdx) => {
            if (mIdx === 0) {
              allNodes.push({
                ...n,
                x: hubX,
                y: hubY,
                vx: 0,
                vy: 0
              });
            } else {
              const mAngle = (mIdx / Math.max(1, grp.length - 1)) * Math.PI * 2;
              const mDist = 45 + Math.sqrt(mIdx) * 22;
              allNodes.push({
                ...n,
                x: hubX + Math.cos(mAngle) * mDist + (Math.random() - 0.5) * 15,
                y: hubY + Math.sin(mAngle) * mDist + (Math.random() - 0.5) * 15,
                vx: 0,
                vy: 0
              });
            }
          });
        });

        document.getElementById('statNs').textContent = payload.namespace || 'default';
        if (payload.mode && document.getElementById('statMode')) {
          document.getElementById('statMode').textContent = payload.mode;
        }
        filterGraph();
      }
    });

    resizeCanvas();
  </script>
</body>
</html>`;
  }
}
