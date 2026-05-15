import { signIn } from "@/lib/auth";

export default function SignInPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-zinc-50 p-6 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1.5">
          <h1 className="text-base font-medium">Personal dashboard</h1>
          <p className="text-sm text-zinc-500">Sign in to continue.</p>
        </div>
        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: "/" });
          }}
        >
          <button
            type="submit"
            className="inline-flex h-9 w-full items-center justify-center rounded-md border border-zinc-200 bg-white text-sm font-medium transition-colors duration-200 ease-out motion-reduce:duration-0 hover:bg-zinc-50 motion-safe:active:scale-[0.99] dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800"
          >
            Continue with Google
          </button>
        </form>
      </div>
    </main>
  );
}
