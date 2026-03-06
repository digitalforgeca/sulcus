import { auth } from "@/auth"
 
export default auth((req) => {
  if (!req.auth && req.nextUrl.pathname.startsWith("/dashboard")) {
    const newUrl = new URL("/api/auth/signin/keycloak", req.nextUrl.origin)
    return Response.redirect(newUrl)
  }
})
 
export const config = {
  matcher: ["/dashboard/:path*"],
}
