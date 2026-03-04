export default function DashboardOverview() {
  return (
    <div className="max-w-4xl">
      <h1 className="text-3xl font-bold mb-8">Tenant Overview</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
        <div className="bg-[#111] p-6 rounded-lg border border-[#222]">
          <h3 className="text-[#888] text-sm uppercase font-bold mb-2">Sync Operations</h3>
          <div className="text-4xl font-bold text-[#ff3e00]">24,592</div>
          <div className="text-sm text-[#555] mt-2">/ 500,000 quota</div>
        </div>
        <div className="bg-[#111] p-6 rounded-lg border border-[#222]">
          <h3 className="text-[#888] text-sm uppercase font-bold mb-2">Nodes in Graph</h3>
          <div className="text-4xl font-bold">1,403</div>
          <div className="text-sm text-[#555] mt-2">Semantic units</div>
        </div>
        <div className="bg-[#111] p-6 rounded-lg border border-[#222]">
          <h3 className="text-[#888] text-sm uppercase font-bold mb-2">Avg Latency</h3>
          <div className="text-4xl font-bold text-green-500">42ms</div>
          <div className="text-sm text-[#555] mt-2">P95: 112ms</div>
        </div>
      </div>

      <h2 className="text-xl font-bold mb-4">Memory Graph Snapshot</h2>
      <div className="bg-[#111] w-full h-[400px] rounded-lg border border-[#222] flex items-center justify-center">
        <p className="text-[#555]">Interactive D3.js Network Graph goes here</p>
      </div>
    </div>
  );
}
