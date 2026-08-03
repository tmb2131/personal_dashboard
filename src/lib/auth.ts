import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";

const ALLOWED_EMAIL = process.env.ALLOWED_EMAIL?.toLowerCase();

/** Compare without leaking where two secrets diverge. */
function secretsMatch(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) return false;
  let difference = 0;
  for (let i = 0; i < provided.length; i += 1) {
    difference |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return difference === 0;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      authorization: {
        params: {
          scope:
            "openid email profile https://www.googleapis.com/auth/calendar.readonly",
          prompt: "consent",
          access_type: "offline",
          response_type: "code",
        },
      },
    }),
    // The Mac app can't use Google here: Google refuses OAuth inside an
    // embedded browser, and no amount of user-agent shaping gets past it. The
    // session is only an access gate anyway — Calendar reads run off
    // GOOGLE_REFRESH_TOKEN server-side — so the desktop app presents its own
    // shared secret instead and gets an otherwise ordinary session.
    Credentials({
      id: "desktop",
      name: "Desktop app",
      credentials: { token: { label: "Desktop token", type: "password" } },
      authorize: (credentials) => {
        const expected = process.env.DESKTOP_TOKEN;
        if (!expected || !ALLOWED_EMAIL) return null;
        const provided =
          typeof credentials?.token === "string" ? credentials.token : "";
        if (!secretsMatch(provided, expected)) return null;
        return { id: "desktop", email: ALLOWED_EMAIL };
      },
    }),
  ],
  session: { strategy: "jwt" },
  callbacks: {
    async signIn({ user }) {
      if (!ALLOWED_EMAIL) return false;
      return user.email?.toLowerCase() === ALLOWED_EMAIL;
    },
    async jwt({ token, account }) {
      if (account) {
        token.accessToken = account.access_token;
      }
      return token;
    },
    async session({ session, token }) {
      // Surface the Google access token to server components that need GCal.
      (session as typeof session & { accessToken?: string }).accessToken =
        token.accessToken as string | undefined;
      return session;
    },
  },
  pages: { signIn: "/sign-in" },
});
