import { auth } from "@/lib/auth";

export default auth((req) => {
  const isPublic =
    req.nextUrl.pathname.startsWith("/sign-in") ||
    req.nextUrl.pathname.startsWith("/api/auth") ||
    req.nextUrl.pathname.startsWith("/api/webhooks") ||
    req.nextUrl.pathname.startsWith("/api/cron");

  if (isPublic) return;
  if (req.auth) return;

  const signInUrl = new URL("/sign-in", req.nextUrl.origin);
  signInUrl.searchParams.set("from", req.nextUrl.pathname);
  return Response.redirect(signInUrl);
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.json).*)"],
};
