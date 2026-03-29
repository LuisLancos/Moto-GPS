"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthContext } from "@/components/auth/AuthProvider";
import Link from "next/link";

export default function LoginPage() {
  const router = useRouter();
  const { login, user, loading: authLoading } = useAuthContext();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // If already logged in, redirect (in effect to avoid setState during render)
  useEffect(() => {
    if (!authLoading && user) {
      router.push("/");
    }
  }, [authLoading, user, router]);

  if (!authLoading && user) {
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-page px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-primary">🏍️ Moto-GPS</h1>
          <p className="text-sm text-muted mt-1">
            Smart Motorcycle Route Planner
          </p>
        </div>

        {/* Card */}
        <form
          onSubmit={handleSubmit}
          className="bg-surface border border-border rounded-lg p-6 flex flex-col gap-4"
        >
          <h2 className="text-lg font-semibold text-primary">Sign In</h2>

          {error && (
            <p className="text-sm text-red-400 bg-red-950/50 rounded-md px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex flex-col gap-1.5">
            <label htmlFor="email" className="text-xs text-muted">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              className="bg-surface-alt border border-border rounded-md px-3 py-2 text-sm text-primary placeholder:text-muted focus:outline-none focus:border-border-focus"
              placeholder="you@example.com"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="password" className="text-xs text-muted">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              className="bg-surface-alt border border-border rounded-md px-3 py-2 text-sm text-primary placeholder:text-muted focus:outline-none focus:border-border-focus"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={loading || !email || !password}
            className="bg-blue-600 hover:bg-blue-500 disabled:bg-surface-hover disabled:text-muted text-white font-medium py-2.5 rounded-md transition-colors text-sm mt-2"
          >
            {loading ? "Signing in..." : "Sign In"}
          </button>

          <p className="text-xs text-muted text-center mt-2">
            Have an invite code?{" "}
            <Link
              href="/register"
              className="text-blue-400 hover:text-blue-300"
            >
              Create account
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
