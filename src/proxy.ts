import { auth } from "@/lib/auth";

export default auth((req) => {
  const isPublic =
    req.nextUrl.pathname.startsWith("/sign-in") ||
    req.nextUrl.pathname.startsWith("/api/auth") ||
    req.nextUrl.pathname.startsWith("/api/webhooks");

  if (isPublic) return;
  if (req.auth) return;

  const signInUrl = new URL("/sign-in", req.nextUrl.origin);
  signInUrl.searchParams.set("from", req.nextUrl.pathname);
  return Response.redirect(signInUrl);
});

export const config = {
  // The manifest and the icon it points at must stay reachable signed-out:
  // browsers fetch the manifest without credentials, so gating it behind auth
  // turns it into a redirect to /sign-in and the install prompt never appears.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icon.svg).*)",
  ],
};
