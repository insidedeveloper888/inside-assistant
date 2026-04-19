"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"login" | "register">("login");
  const router = useRouter();
  const supabase = createClient();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    if (mode === "login") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setError(error.message);
        setLoading(false);
        return;
      }
    } else {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) {
        setError(error.message);
        setLoading(false);
        return;
      }
    }

    // Auto-link Lark account after login/register
    try {
      await fetch("/api/auth/link-lark", { method: "POST" });
    } catch {}

    router.push("/chat");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 px-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-500/10">
            <span className="text-2xl">🧠</span>
          </div>
          <h1 className="mt-4 text-xl font-semibold text-white">Inside Assistant</h1>
          <p className="mt-1 text-sm text-zinc-400">
            {mode === "login" ? "Sign in to continue" : "Create your account"}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-white placeholder-zinc-500 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-white placeholder-zinc-500 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
          />

          {error && (
            <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-indigo-600 py-3 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:opacity-50"
          >
            {loading ? "..." : mode === "login" ? "Sign In" : "Create Account"}
          </button>
        </form>

        <p className="text-center text-xs text-zinc-500">
          {mode === "login" ? "No account?" : "Already have an account?"}{" "}
          <button
            onClick={() => setMode(mode === "login" ? "register" : "login")}
            className="text-indigo-400 hover:text-indigo-300"
          >
            {mode === "login" ? "Register" : "Sign in"}
          </button>
        </p>
      </div>
    </div>
  );
}
