'use client';

export const dynamic = 'force-dynamic';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
  getSortedRowModel,
  SortingState
} from '@tanstack/react-table';
import { Trash2, RefreshCw, ArrowUpDown } from 'lucide-react';
import { useAuth } from '@/components/providers';

declare module '@tanstack/react-table' {
  interface ColumnMeta<TData extends unknown, TValue> {
    align?: 'left' | 'center' | 'right';
  }
}

interface MemoryNode {
  id: string;
  label: string;
  memory_type: string;
  heat: number;
}

const columnHelper = createColumnHelper<MemoryNode>();

export default function MemoriesPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [sorting, setSorting] = useState<SortingState>([]);
  const [rowSelection, setRowSelection] = useState({});

  const fetchMemories = async () => {
    const token = process.env.NEXT_PUBLIC_SULCUS_API_KEY || '';
    const serverUrl = process.env.NEXT_PUBLIC_SULCUS_SERVER_URL || 'https://sulcus-server.calmstone-a7a24a97.westus.azurecontainerapps.io';
    
    const res = await fetch(`${serverUrl}/api/v1/agent/nodes`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!res.ok) throw new Error('Failed to fetch memories');
    return res.json() as Promise<MemoryNode[]>;
  };

  const { data: nodes = [], isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: ['memories'],
    queryFn: fetchMemories,
    enabled: !!user || !!process.env.NEXT_PUBLIC_SULCUS_API_KEY,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const token = process.env.NEXT_PUBLIC_SULCUS_API_KEY || '';
      const serverUrl = process.env.NEXT_PUBLIC_SULCUS_SERVER_URL || 'https://sulcus-server.calmstone-a7a24a97.westus.azurecontainerapps.io';
      
      const res = await fetch(`${serverUrl}/api/v1/agent/nodes/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!res.ok) throw new Error('Failed to delete memory');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['memories'] });
    },
    onError: (err: any) => {
      alert(err.message);
    }
  });

  const handleDelete = (id: string) => {
    if (!confirm('Are you sure you want to permanently delete this memory? It will be removed from all agents.')) return;
    deleteMutation.mutate(id);
  };

  const columns = [
    columnHelper.accessor('label', {
      header: 'Label / Summary',
      cell: info => <span className="truncate max-w-md block text-[#ccc] group-hover:text-white" title={info.getValue()}>{info.getValue()}</span>,
    }),
    columnHelper.accessor('memory_type', {
      header: 'Type',
      cell: info => <span className="text-xs text-[#00F0FF]/70 tracking-widest uppercase">{info.getValue()}</span>,
    }),
    columnHelper.accessor('heat', {
      header: () => (
        <div className="flex items-center justify-end gap-2 cursor-pointer hover:text-white">
          Heat <ArrowUpDown size={14} />
        </div>
      ),
      cell: info => <span className="text-[#D4AF37] font-mono">{info.getValue().toFixed(3)}</span>,
      meta: { align: 'right' }
    }),
    columnHelper.display({
      id: 'actions',
      header: () => <div className="text-center">Actions</div>,
      cell: props => (
        <div className="text-center">
          <button 
            onClick={() => handleDelete(props.row.original.id)}
            disabled={deleteMutation.isPending}
            className="text-red-500/50 hover:text-red-500 transition-colors"
            title="Delete Node"
          >
            <Trash2 size={16} />
          </button>
        </div>
      ),
    }),
  ];

  const table = useReactTable({
    data: nodes,
    columns,
    state: {
      sorting,
      rowSelection,
    },
    onSortingChange: setSorting,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="max-w-5xl font-sans">
      <div className="flex justify-between items-end mb-8">
        <h1 className="text-3xl font-bold tracking-widest text-[#D4AF37] uppercase flex items-center gap-3">
          <div className="w-2 h-2 bg-[#00F0FF] shadow-[0_0_8px_#00F0FF]"></div>
          Cloud Memory Management
        </h1>
        <button 
          onClick={() => refetch()}
          disabled={isRefetching}
          className="text-xs text-[#00F0FF] border border-[#00F0FF]/30 px-4 py-2 hover:bg-[#00F0FF]/10 transition-colors uppercase tracking-widest flex items-center gap-2 disabled:opacity-50"
        >
          <RefreshCw size={14} className={isRefetching ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="bg-red-950/30 border border-red-500/50 text-red-400 p-4 font-mono tracking-wider mb-8 flex justify-between items-center">
          <span>Error: {error.message}</span>
        </div>
      )}

      <div className="bg-[#0a1520] border border-[#D4AF37]/30 shadow-[0_0_20px_rgba(0,0,0,0.5)] relative overflow-x-auto">
        <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-[#D4AF37]"></div>
        <div className="absolute top-0 right-0 w-2 h-2 border-t border-r border-[#D4AF37]"></div>
        <div className="absolute bottom-0 left-0 w-2 h-2 border-b border-l border-[#D4AF37]"></div>
        <div className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-[#D4AF37]"></div>

        <table className="w-full text-left font-mono text-sm">
          <thead className="bg-[#111820] text-[#D4AF37] text-xs uppercase tracking-widest border-b border-[#D4AF37]/30">
            {table.getHeaderGroups().map(headerGroup => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map(header => (
                  <th key={header.id} className={`p-4 font-normal ${header.column.columnDef.meta?.align === 'right' ? 'text-right' : ''}`}>
                    {header.isPlaceholder ? null : (
                      <div
                        {...{
                          className: header.column.getCanSort() ? 'cursor-pointer select-none flex items-center gap-2' : '',
                          onClick: header.column.getToggleSortingHandler(),
                        }}
                      >
                        {flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                        {{
                          asc: ' 🔼',
                          desc: ' 🔽',
                        }[header.column.getIsSorted() as string] ?? null}
                      </div>
                    )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody className="divide-y divide-[#D4AF37]/10">
            {isLoading ? (
              <tr>
                <td colSpan={columns.length} className="p-12 text-center text-[#888] animate-pulse uppercase tracking-widest">Loading memory graph...</td>
              </tr>
            ) : table.getRowModel().rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="p-12 text-center text-[#888] uppercase tracking-widest">No memories found for this tenant.</td>
              </tr>
            ) : (
              table.getRowModel().rows.map(row => (
                <tr key={row.id} className="hover:bg-[#D4AF37]/5 transition-colors group">
                  {row.getVisibleCells().map(cell => (
                    <td key={cell.id} className={`p-4 ${cell.column.columnDef.meta?.align === 'right' ? 'text-right' : ''}`}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}