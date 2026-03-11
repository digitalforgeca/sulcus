import { NextResponse } from "next/server";
import { getSession } from "@/auth";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ user: null });
  }
  // Never expose tokens to the client
  return NextResponse.json({
    user: {
      id: session.userId,
      email: session.email,
      name: session.name,
      roles: session.roles,
    },
  });
}
