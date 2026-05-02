"use client";

import { useState, useCallback } from "react";

export default function KeryxNewsletter() {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [msg, setMsg] = useState("");
  const [ok, setOk] = useState(false);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg("");
    try {
      const r = await fetch("https://keryx.technocraftonline.com/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          name: name || undefined,
          source: "Sulcus",
          list: "Sulcus",
        }),
      });
      const d = await r.json();
      setMsg(d.message);
      setOk(r.ok);
      if (r.ok) {
        setEmail("");
        setName("");
      }
    } catch {
      setMsg("Something went wrong.");
      setOk(false);
    }
  }, [email, name]);

  return (
    <form onSubmit={handleSubmit} className="max-w-[400px]">
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="your@email.com"
        required
        className="w-full p-[10px] mb-2 border border-[#333] bg-[#1a1a1a] text-[#e0dcd3] rounded-[3px] text-sm outline-none focus:border-[#D4AF37] transition-colors"
      />
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Your name (optional)"
        className="w-full p-[10px] mb-2 border border-[#333] bg-[#1a1a1a] text-[#e0dcd3] rounded-[3px] text-sm outline-none focus:border-[#D4AF37] transition-colors"
      />
      <button
        type="submit"
        className="w-full p-[10px] bg-[#d4a843] text-[#1a1a1a] border-none font-semibold rounded-[3px] cursor-pointer hover:brightness-110 transition-all text-sm"
      >
        Subscribe
      </button>
      {msg && (
        <p className={`mt-2 text-[13px] ${ok ? "text-[#6aaa8a]" : "text-[#e8653a]"}`}>
          {msg}
        </p>
      )}
    </form>
  );
}
