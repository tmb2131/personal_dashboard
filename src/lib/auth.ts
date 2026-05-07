import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

const ALLOWED_EMAIL = process.env.ALLOWED_EMAIL?.toLowerCase();

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
