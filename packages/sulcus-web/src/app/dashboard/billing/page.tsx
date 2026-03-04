export default function BillingPage() {
  return (
    <div className="max-w-2xl">
      <h1 className="text-3xl font-bold mb-8">Billing & Subscription</h1>
      
      <div className="bg-[#111] p-8 rounded-lg border border-[#222] mb-8">
        <h2 className="text-xl font-bold mb-2">Current Plan: Starter</h2>
        <p className="text-[#888] mb-6">You are using the free Local Sidecar tier.</p>
        
        <div className="bg-[#1a1a1a] p-4 rounded border border-[#333] mb-6">
          <div className="flex justify-between mb-2">
            <span className="text-sm">Storage Limit</span>
            <span className="text-sm font-bold">1.2 GB / 10 GB</span>
          </div>
          <div className="w-full bg-[#000] rounded-full h-2">
            <div className="bg-[#ff3e00] h-2 rounded-full" style={{ width: '12%' }}></div>
          </div>
        </div>
      </div>

      <div className="bg-[#ff3e00]/10 p-8 rounded-lg border border-[#ff3e00]/30">
        <h2 className="text-2xl font-bold mb-2 text-[#ff3e00]">Upgrade to TEAM</h2>
        <p className="text-[#ccc] mb-6">Unlock Remote MCP, 100GB storage, and shared embeddings for your entire agent fleet.</p>
        
        <div className="flex items-center gap-4">
          <button className="bg-[#ff3e00] text-white px-6 py-3 rounded font-bold hover:opacity-90 transition-opacity">
            Upgrade via Stripe - $299/mo
          </button>
          <span className="text-[#555] text-sm">Secure checkout</span>
        </div>
      </div>
    </div>
  );
}
