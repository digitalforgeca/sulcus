'use client';

export const dynamic = 'force-dynamic';

import { useState, useCallback, Fragment } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
  getSortedRowModel,
  SortingState,
  getExpandedRowModel,
  ExpandedState,
} from '@tanstack/react-table';
import {
  Trash2, RefreshCw, ChevronDown, ChevronRight,
  Pin, PinOff, Pencil, Check, X, Search, Filter,
  ChevronLeft, ChevronsLeft, ChevronsRight,
} from 'lucide-react';
import { useAuth } from '@/components/providers';

const SERVER_URL = process.env.NEXT_PUBLIC_SULCUS_SERVER_URL || 'https://sulcus-server.calmstone-a7a24a97.westus.azurecontainerapps.io';
const API_KEY = process.env.NEXT_PUBLIC_SULCUS_API_KEY || '';

interface MemoryNode {
  id: string;
  label: string;
  memory_type: string;
  heat: number;
  base_utility: number;
  is_pinned: boolean;
  modality: string;
  namespace: string;
  updated_at: string;
}

interface PaginatedResponse {
  items: MemoryNode[];
  total: number;
  page: number;
  page_size: number;
}

const MEMORY_TYPES = ['episodic', 'semantic', 'procedural', 'preference', 'fact'];
const PAGE_SIZES = [10, 25, 50, 100];

const columnHelper = createColumnHelper<MemoryNode>();

function HeatBar({ value }: { value: number }) {
  const pct = Math.min(value * 100, 100);
  const color = value > 0.7 ? '#D4AF37' : value > 0.3 ? '#00F0FF' : '#333';
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 bg-black/50 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color, boxShadow: `0 0 6px ${color}` }} />
      </div>
      <span className="text-xs font-mono text-[#888]">{value.toFixed(2)}</span>
    </div>
  );
}

function TypeBadge({ type: t }: { type: string }) {
  const colors: Record<string, string> = {
    episodic: 'border-purple-500/50 text-purple-400',
    semantic: 'border-blue-500/50 text-blue-400',
    procedural: 'border-green-500/50 text-green-400',
    preference: 'border-amber-500/50 text-amber-400',
    fact: 'border-cyan-500/50 text-cyan-400',
  };
  return (
    <span className={`text-[10px] px-2 py-0.5 border rounded-full uppercase tracking-widest ${colors[t] || 'border-[#333] text-[#666]'}`}>
      {t}
    </span>
  );
}

export default function MemoriesPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // Pagination & filter state
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [typeFilter, setTypeFilter] = useState('');
  const [searchText, setSearchText] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [pinnedFilter, setPinnedFilter] = useState<string>('');
  const [sortField, setSortField] = useState('heat');
  const [sortOrder, setSortOrder] = useState('desc');
  const [sorting, setSorting] = useState<SortingState>([]);
  const [expanded, setExpanded] = useState<ExpandedState>({});

  // Inline edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editType, setEditType] = useState('');

  const queryKey = ['memories', page, pageSize, typeFilter, searchText, pinnedFilter, sortField, sortOrder];

  const fetchMemories = useCallback(async (): Promise<PaginatedResponse> => {
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('page_size', String(pageSize));
    params.set('sort', sortField);
    params.set('order', sortOrder);
    if (typeFilter) params.set('memory_type', typeFilter);
    if (searchText) params.set('search', searchText);
    if (pinnedFilter === 'true') params.set('pinned', 'true');
    if (pinnedFilter === 'false') params.set('pinned', 'false');

    const res = await fetch(`${SERVER_URL}/api/v1/agent/nodes?${params}`, {
      headers: { 'Authorization': `Bearer ${API_KEY}` },
    });
    if (!res.ok) throw new Error('Failed to fetch memories');
    return res.json();
  }, [page, pageSize, typeFilter, searchText, pinnedFilter, sortField, sortOrder]);

  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey,
    queryFn: fetchMemories,
    enabled: !!user || !!API_KEY,
    placeholderData: keepPreviousData,
  });

  const nodes = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / pageSize);

  // Mutations
  const patchMutation = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Record<string, unknown> }) => {
      const res = await fetch(`${SERVER_URL}/api/v1/agent/nodes/${id}`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error('Failed to update memory');
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['memories'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`${SERVER_URL}/api/v1/agent/nodes/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${API_KEY}` },
      });
      if (!res.ok) throw new Error('Failed to delete memory');
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['memories'] }),
  });

  const handleDelete = (id: string) => {
    if (!confirm('Permanently delete this memory node?')) return;
    deleteMutation.mutate(id);
  };

  const togglePin = (node: MemoryNode) => {
    patchMutation.mutate({ id: node.id, patch: { is_pinned: !node.is_pinned } });
  };

  const startEdit = (node: MemoryNode) => {
    setEditingId(node.id);
    setEditLabel(node.label);
    setEditType(node.memory_type);
  };

  const saveEdit = () => {
    if (!editingId) return;
    patchMutation.mutate(
      { id: editingId, patch: { label: editLabel, memory_type: editType } },
      { onSuccess: () => setEditingId(null) }
    );
  };

  const cancelEdit = () => setEditingId(null);

  const handleSearch = () => {
    setSearchText(searchInput);
    setPage(1);
  };

  const columns = [
    columnHelper.display({
      id: 'expand',
      header: () => null,
      cell: ({ row }) => (
        <button onClick={() => row.toggleExpanded()} className="text-[#555] hover:text-[#D4AF37] transition-colors p-1">
          {row.getIsExpanded() ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
      ),
      size: 32,
    }),
    columnHelper.accessor('is_pinned', {
      header: () => <Pin size={12} className="text-[#555]" />,
      cell: info => (
        <button
          onClick={() => togglePin(info.row.original)}
          className={`transition-colors ${info.getValue() ? 'text-[#D4AF37]' : 'text-[#333] hover:text-[#555]'}`}
          title={info.getValue() ? 'Unpin' : 'Pin'}
        >
          {info.getValue() ? <Pin size={14} /> : <PinOff size={14} />}
        </button>
      ),
      size: 40,
    }),
    columnHelper.accessor('label', {
      header: 'Summary',
      cell: info => {
        const node = info.row.original;
        if (editingId === node.id) {
          return (
            <input
              value={editLabel}
              onChange={e => setEditLabel(e.target.value)}
              className="w-full bg-[#111820] border border-[#D4AF37]/50 text-white px-2 py-1 text-sm font-mono focus:outline-none focus:border-[#D4AF37]"
              autoFocus
            />
          );
        }
        const label = info.getValue();
        const display = label.length > 120 ? label.slice(0, 120) + '…' : label;
        return <span className="text-[#ccc] text-sm" title={label}>{display}</span>;
      },
    }),
    columnHelper.accessor('memory_type', {
      header: 'Type',
      cell: info => {
        if (editingId === info.row.original.id) {
          return (
            <select
              value={editType}
              onChange={e => setEditType(e.target.value)}
              className="bg-[#111820] border border-[#D4AF37]/50 text-white text-xs px-1 py-0.5 focus:outline-none"
            >
              {MEMORY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          );
        }
        return <TypeBadge type={info.getValue()} />;
      },
      size: 100,
    }),
    columnHelper.accessor('heat', {
      header: 'Heat',
      cell: info => <HeatBar value={info.getValue()} />,
      size: 130,
    }),
    columnHelper.accessor('updated_at', {
      header: 'Updated',
      cell: info => {
        const d = new Date(info.getValue());
        const now = new Date();
        const diffMs = now.getTime() - d.getTime();
        const diffH = Math.floor(diffMs / 3600000);
        const diffD = Math.floor(diffH / 24);
        let relative: string;
        if (diffH < 1) relative = 'just now';
        else if (diffH < 24) relative = `${diffH}h ago`;
        else if (diffD < 30) relative = `${diffD}d ago`;
        else relative = d.toLocaleDateString();
        return <span className="text-xs text-[#555]" title={d.toISOString()}>{relative}</span>;
      },
      size: 80,
    }),
    columnHelper.display({
      id: 'actions',
      header: () => null,
      cell: ({ row }) => {
        const node = row.original;
        if (editingId === node.id) {
          return (
            <div className="flex gap-1">
              <button onClick={saveEdit} className="text-green-500 hover:text-green-400 p-1" title="Save"><Check size={14} /></button>
              <button onClick={cancelEdit} className="text-red-500 hover:text-red-400 p-1" title="Cancel"><X size={14} /></button>
            </div>
          );
        }
        return (
          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={() => startEdit(node)} className="text-[#555] hover:text-[#00F0FF] p-1" title="Edit"><Pencil size={14} /></button>
            <button onClick={() => handleDelete(node.id)} className="text-[#555] hover:text-red-500 p-1" title="Delete"><Trash2 size={14} /></button>
          </div>
        );
      },
      size: 70,
    }),
  ];

  const table = useReactTable({
    data: nodes,
    columns,
    state: { sorting, expanded },
    onSortingChange: setSorting,
    onExpandedChange: setExpanded,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    getRowCanExpand: () => true,
  });

  return (
    <div className="max-w-6xl font-sans">
      {/* Header */}
      <div className="flex justify-between items-end mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-widest text-[#D4AF37] uppercase flex items-center gap-3">
            <div className="w-2 h-2 bg-[#00F0FF] shadow-[0_0_8px_#00F0FF]"></div>
            Memory Nodes
          </h1>
          <p className="text-[#555] text-sm mt-1 font-mono">{total.toLocaleString()} nodes in graph</p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isRefetching}
          className="text-xs text-[#00F0FF] border border-[#00F0FF]/30 px-4 py-2 hover:bg-[#00F0FF]/10 transition-colors uppercase tracking-widest flex items-center gap-2 disabled:opacity-50"
        >
          <RefreshCw size={14} className={isRefetching ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap gap-3 mb-6">
        {/* Search */}
        <div className="flex items-center gap-0">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#555]" />
            <input
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              placeholder="Search summaries…"
              className="bg-[#0a1520] border border-[#D4AF37]/20 text-white text-sm pl-9 pr-3 py-2 w-64 focus:outline-none focus:border-[#D4AF37]/50 placeholder-[#333]"
            />
          </div>
          <button onClick={handleSearch} className="bg-[#0a1520] border border-[#D4AF37]/20 border-l-0 px-3 py-2 text-[#555] hover:text-[#D4AF37] transition-colors">
            <Filter size={14} />
          </button>
        </div>

        {/* Type filter */}
        <select
          value={typeFilter}
          onChange={e => { setTypeFilter(e.target.value); setPage(1); }}
          className="bg-[#0a1520] border border-[#D4AF37]/20 text-sm text-[#888] px-3 py-2 focus:outline-none appearance-none cursor-pointer"
        >
          <option value="">All types</option>
          {MEMORY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>

        {/* Pinned filter */}
        <select
          value={pinnedFilter}
          onChange={e => { setPinnedFilter(e.target.value); setPage(1); }}
          className="bg-[#0a1520] border border-[#D4AF37]/20 text-sm text-[#888] px-3 py-2 focus:outline-none appearance-none cursor-pointer"
        >
          <option value="">All nodes</option>
          <option value="true">Pinned only</option>
          <option value="false">Unpinned only</option>
        </select>

        {/* Sort */}
        <select
          value={`${sortField}:${sortOrder}`}
          onChange={e => {
            const [f, o] = e.target.value.split(':');
            setSortField(f);
            setSortOrder(o);
            setPage(1);
          }}
          className="bg-[#0a1520] border border-[#D4AF37]/20 text-sm text-[#888] px-3 py-2 focus:outline-none appearance-none cursor-pointer"
        >
          <option value="heat:desc">Hottest first</option>
          <option value="heat:asc">Coldest first</option>
          <option value="updated_at:desc">Recently updated</option>
          <option value="updated_at:asc">Oldest first</option>
          <option value="utility:desc">Highest utility</option>
          <option value="label:asc">A → Z</option>
        </select>

        {/* Page size */}
        <select
          value={pageSize}
          onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}
          className="bg-[#0a1520] border border-[#D4AF37]/20 text-sm text-[#888] px-3 py-2 focus:outline-none appearance-none cursor-pointer"
        >
          {PAGE_SIZES.map(s => <option key={s} value={s}>{s} per page</option>)}
        </select>

        {/* Clear filters */}
        {(typeFilter || searchText || pinnedFilter) && (
          <button
            onClick={() => { setTypeFilter(''); setSearchText(''); setSearchInput(''); setPinnedFilter(''); setPage(1); }}
            className="text-xs text-red-400/70 hover:text-red-400 px-3 py-2 uppercase tracking-widest"
          >
            Clear
          </button>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-950/30 border border-red-500/50 text-red-400 p-4 font-mono tracking-wider mb-6">
          Error: {(error as Error).message}
        </div>
      )}

      {/* Table */}
      <div className="bg-[#0a1520] border border-[#D4AF37]/30 shadow-[0_0_20px_rgba(0,0,0,0.5)] relative overflow-x-auto">
        <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-[#D4AF37]"></div>
        <div className="absolute top-0 right-0 w-2 h-2 border-t border-r border-[#D4AF37]"></div>
        <div className="absolute bottom-0 left-0 w-2 h-2 border-b border-l border-[#D4AF37]"></div>
        <div className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-[#D4AF37]"></div>

        <table className="w-full text-left text-sm">
          <thead className="bg-[#111820] text-[#D4AF37] text-xs uppercase tracking-widest border-b border-[#D4AF37]/30">
            {table.getHeaderGroups().map(headerGroup => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map(header => (
                  <th key={header.id} className="p-3 font-normal" style={{ width: header.getSize() !== 150 ? header.getSize() : undefined }}>
                    {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody className="divide-y divide-[#D4AF37]/10">
            {isLoading ? (
              <tr><td colSpan={columns.length} className="p-12 text-center text-[#888] animate-pulse uppercase tracking-widest">Loading memory graph…</td></tr>
            ) : nodes.length === 0 ? (
              <tr><td colSpan={columns.length} className="p-12 text-center text-[#555] uppercase tracking-widest">No memories match your filters.</td></tr>
            ) : (
              table.getRowModel().rows.map(row => (
                <Fragment key={row.id}>
                  <tr className="hover:bg-[#D4AF37]/5 transition-colors group">
                    {row.getVisibleCells().map(cell => (
                      <td key={cell.id} className="p-3">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                  {row.getIsExpanded() && (
                    <tr className="bg-[#060d14]">
                      <td colSpan={columns.length} className="p-4">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs mb-3">
                          <div>
                            <span className="text-[#555] uppercase tracking-wider block mb-1">Base Utility</span>
                            <span className="text-white font-mono">{row.original.base_utility.toFixed(3)}</span>
                          </div>
                          <div>
                            <span className="text-[#555] uppercase tracking-wider block mb-1">Modality</span>
                            <span className="text-white">{row.original.modality}</span>
                          </div>
                          <div>
                            <span className="text-[#555] uppercase tracking-wider block mb-1">Namespace</span>
                            <span className="text-white">{row.original.namespace}</span>
                          </div>
                          <div>
                            <span className="text-[#555] uppercase tracking-wider block mb-1">Node ID</span>
                            <span className="text-[#555] font-mono text-[10px] break-all">{row.original.id}</span>
                          </div>
                        </div>
                        <div>
                          <span className="text-[#555] uppercase tracking-wider text-xs block mb-1">Full Content</span>
                          <pre className="text-[#999] text-xs font-mono whitespace-pre-wrap max-h-48 overflow-y-auto bg-black/30 p-3 border border-[#D4AF37]/10 rounded">
                            {row.original.label}
                          </pre>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <span className="text-xs text-[#555] font-mono">
            Showing {((page - 1) * pageSize) + 1}–{Math.min(page * pageSize, total)} of {total.toLocaleString()}
          </span>
          <div className="flex items-center gap-1">
            <button onClick={() => setPage(1)} disabled={page === 1} className="p-2 text-[#555] hover:text-[#D4AF37] disabled:opacity-20 transition-colors"><ChevronsLeft size={14} /></button>
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="p-2 text-[#555] hover:text-[#D4AF37] disabled:opacity-20 transition-colors"><ChevronLeft size={14} /></button>

            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              let p: number;
              if (totalPages <= 5) p = i + 1;
              else if (page <= 3) p = i + 1;
              else if (page >= totalPages - 2) p = totalPages - 4 + i;
              else p = page - 2 + i;
              return (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className={`w-8 h-8 text-xs font-mono transition-colors ${p === page ? 'bg-[#D4AF37]/20 text-[#D4AF37] border border-[#D4AF37]/50' : 'text-[#555] hover:text-white'}`}
                >
                  {p}
                </button>
              );
            })}

            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="p-2 text-[#555] hover:text-[#D4AF37] disabled:opacity-20 transition-colors"><ChevronRight size={14} /></button>
            <button onClick={() => setPage(totalPages)} disabled={page === totalPages} className="p-2 text-[#555] hover:text-[#D4AF37] disabled:opacity-20 transition-colors"><ChevronsRight size={14} /></button>
          </div>
        </div>
      )}
    </div>
  );
}
