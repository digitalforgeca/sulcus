import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const sessionCookie = request.cookies.get("sulcus.session");

  if (!sessionCookie) {
    const url = new URL("/", request.nextUrl.origin);
    url.searchParams.set("signin", "1");
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
