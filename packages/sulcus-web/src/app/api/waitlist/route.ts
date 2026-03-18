import { NextRequest, NextResponse } from "next/server";

const SERVER_URL = process.env.SULCUS_SERVER_URL || process.env.NEXT_PUBLIC_SULCUS_SERVER_URL || "https://sulcus-server.calmstone-a7a24a97.westus.azurecontainerapps.io";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const res = await fetch(`${SERVER_URL}/api/v1/waitlist`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: "Failed to record" }, { status: 500 });
  }
}
