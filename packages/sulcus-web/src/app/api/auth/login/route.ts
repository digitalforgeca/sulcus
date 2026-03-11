import { NextRequest, NextResponse } from "next/server";
import { login, setSessionCookie } from "@/auth";

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();
    if (!email || !password) {
      return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
    }

    const result = await login(email, password);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 401 });
    }

    await setSessionCookie(result.session);
    return NextResponse.json({
      user: {
        id: result.session.userId,
        email: result.session.email,
        name: result.session.name,
        roles: result.session.roles,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
