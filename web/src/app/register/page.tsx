"use client";

import { Suspense, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuthContext } from "@/components/auth/AuthProvider";
import Link from "next/link";

export default function RegisterPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-screen bg-page">
          <div className="text-muted text-sm">Loading...</div>
        </div>
      }
    >
      <RegisterForm />
    </Suspense>
  );
}

function RegisterForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { register, user, loading: authLoading } = useAuthContext();

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-fill invite code from URL param (e.g. /register?code=abc123)
  useEffect(() => {
    const urlCode = searchParams.get("code");
    if (urlCode) setCode(urlCode);
  }, [searchParams]);

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

    // Client-side validation
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);
    try {
      await register(code, name, email, password);
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
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
          <p className="text-sm text-muted mt-1">Create your account</p>
        </div>

        {/* Card */}
        <form
          onSubmit={handleSubmit}
          className="bg-surface border border-border rounded-lg p-6 flex flex-col gap-4"
        >
          <h2 className="text-lg font-semibold text-primary">Register</h2>

          {error && (
            <p className="text-sm text-red-400 bg-red-950/50 rounded-md px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex flex-col gap-1.5">
            <label htmlFor="code" className="text-xs text-muted">
              Invite Code
            </label>
            <input
              id="code"
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
              autoFocus
              className="bg-surface-alt border border-border rounded-md px-3 py-2 text-sm text-primary font-mono placeholder:text-muted focus:outline-none focus:border-border-focus"
              placeholder="Enter invite code"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="name" className="text-xs text-muted">
              Name
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="bg-surface-alt border border-border rounded-md px-3 py-2 text-sm text-primary placeholder:text-muted focus:outline-none focus:border-border-focus"
              placeholder="Your name"
            />
          </div>

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
              placeholder="At least 8 characters"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="confirmPassword" className="text-xs text-muted">
              Confirm Password
            </label>
            <input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              className="bg-surface-alt border border-border rounded-md px-3 py-2 text-sm text-primary placeholder:text-muted focus:outline-none focus:border-border-focus"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={loading || !code || !name || !email || !password}
            className="bg-blue-600 hover:bg-blue-500 disabled:bg-surface-hover disabled:text-muted text-white font-medium py-2.5 rounded-md transition-colors text-sm mt-2"
          >
            {loading ? "Creating account..." : "Create Account"}
          </button>

          <p className="text-xs text-muted text-center mt-2">
            Already have an account?{" "}
            <Link href="/login" className="text-blue-400 hover:text-blue-300">
              Sign in
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
