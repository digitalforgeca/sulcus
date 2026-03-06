import { auth, signOut } from "@/auth";
import { redirect } from "next/navigation";

export default async function AccountPage() {
  const session = await auth();

  if (!session) {
    redirect("/api/auth/signin/keycloak");
  }

  // Define logout action
  const handleSignOut = async () => {
    "use server";
    
    const issuer = process.env.AUTH_KEYCLOAK_ISSUER;
    const idToken = (session as any).idToken;
    const nextUrl = process.env.NEXT_PUBLIC_SULCUS_SERVER_URL || "https://sulcus.dforge.ca";

    let logoutUrl = "";
    if (issuer && idToken) {
        logoutUrl = `${issuer}/protocol/openid-connect/logout?id_token_hint=${idToken}&post_logout_redirect_uri=${encodeURIComponent(nextUrl)}`;
    }

    await signOut({ redirect: false });
    
    if (logoutUrl) {
        redirect(logoutUrl);
    } else {
        redirect("/");
    }
  };

  const accountConsoleUrl = `${process.env.AUTH_KEYCLOAK_ISSUER}/account`;

  return (
    <div className="max-w-2xl font-sans">
      <h1 className="text-3xl font-bold mb-8 tracking-widest text-[#D4AF37] uppercase flex items-center gap-3">
        <div className="w-2 h-2 bg-[#00F0FF] shadow-[0_0_8px_#00F0FF]"></div>
        Identity & Access
      </h1>
      
      <div className="bg-[#0a1520] p-8 rounded-lg border border-[#D4AF37]/30 shadow-[0_0_15px_rgba(212,175,55,0.05)] relative mb-8">
        <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-[#D4AF37]"></div>
        <div className="absolute top-0 right-0 w-2 h-2 border-t border-r border-[#D4AF37]"></div>
        <div className="absolute bottom-0 left-0 w-2 h-2 border-b border-l border-[#D4AF37]"></div>
        <div className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-[#D4AF37]"></div>
        
        <h2 className="text-xl font-bold mb-4 text-white uppercase tracking-widest">Active Profile</h2>
        
        <div className="space-y-4 font-mono text-sm">
            <div className="flex flex-col">
                <span className="text-[#888] uppercase tracking-wider text-xs">Subject Identifier (Sub)</span>
                <span className="text-[#00F0FF]">{session.user?.id || 'Unknown'}</span>
            </div>
            <div className="flex flex-col">
                <span className="text-[#888] uppercase tracking-wider text-xs">Name</span>
                <span className="text-white">{session.user?.name || 'Unknown'}</span>
            </div>
            <div className="flex flex-col">
                <span className="text-[#888] uppercase tracking-wider text-xs">Email</span>
                <span className="text-white">{session.user?.email || 'Unknown'}</span>
            </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-[#0a1520] p-6 border border-[#D4AF37]/30 flex flex-col justify-between h-full relative group hover:border-[#00F0FF]/50 transition-colors">
            <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-[#D4AF37]"></div>
            <div className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-[#D4AF37]"></div>
            <div>
                <h3 className="text-lg font-bold text-white mb-2 tracking-widest uppercase">Account Console</h3>
                <p className="text-sm text-[#888] mb-6">Manage your credentials, two-factor authentication, and active sessions directly within the secure Keycloak environment.</p>
            </div>
            <a 
                href={accountConsoleUrl} 
                target="_blank" 
                rel="noreferrer"
                className="bg-transparent border border-[#D4AF37] text-[#D4AF37] px-4 py-2 font-bold hover:bg-[#D4AF37] hover:text-[#050a0f] transition-all tracking-widest text-center text-sm"
            >
                MANAGE SECURITY
            </a>
        </div>

        <div className="bg-[#0a1520] p-6 border border-red-900/30 flex flex-col justify-between h-full relative group hover:border-red-500/50 transition-colors">
            <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-red-500"></div>
            <div className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-red-500"></div>
            <div>
                <h3 className="text-lg font-bold text-white mb-2 tracking-widest uppercase">Session Control</h3>
                <p className="text-sm text-[#888] mb-6">Terminate your current session and revoke the access token securely via the Identity Provider.</p>
            </div>
            <form action={handleSignOut}>
                <button 
                    type="submit"
                    className="w-full bg-red-950/30 border border-red-500/50 text-red-400 px-4 py-2 font-bold hover:bg-red-500 hover:text-white transition-all tracking-widest text-center text-sm"
                >
                    SIGN OUT
                </button>
            </form>
        </div>
      </div>
    </div>
  );
}
