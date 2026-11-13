"use client";

import React, { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { isEmailAuthorized, PRIMARY_ADMIN_EMAIL } from "@/lib/auth-whitelist";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<any>(null);
  const [emailInput, setEmailInput] = useState(PRIMARY_ADMIN_EMAIL);
  const [passwordInput, setPasswordInput] = useState("");
  const [otpInput, setOtpInput] = useState("");
  const [authMode, setAuthMode] = useState<"password" | "otp">("password");
  const [otpSent, setOtpSent] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    // Check active session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user || null);
      setLoading(false);
    });

    // Listen for auth state changes (login, logout, token refresh)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user || null);
      setLoading(false);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase || !emailInput.trim()) return;

    if (!passwordInput.trim()) {
      setErrorMessage("Please enter your password in the Master Password field.");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    setInfoMessage(null);

    try {
      // 1. Attempt standard password login
      const { error } = await supabase.auth.signInWithPassword({
        email: emailInput.trim(),
        password: passwordInput,
      });

      if (error) {
        // 2. If user does not exist in Supabase yet, automatically initialize it!
        if (
          error.message.toLowerCase().includes("invalid login credentials") ||
          error.message.toLowerCase().includes("user not found")
        ) {
          setInfoMessage("First-time setup detected. Initializing your admin account with this password...");

          const initRes = await fetch("/api/auth/setup-admin", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email: emailInput.trim(),
              password: passwordInput,
            }),
          });

          const initData = await initRes.json();
          if (!initRes.ok) {
            throw new Error(initData.error || "Failed to initialize admin account.");
          }

          // Retry login now that user is created and confirmed
          const retry = await supabase.auth.signInWithPassword({
            email: emailInput.trim(),
            password: passwordInput,
          });

          if (retry.error) {
            throw retry.error;
          }

          setInfoMessage("✓ Admin account initialized and logged in successfully!");
          return;
        }

        throw error;
      }
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to sign in. Check your email and password.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleInitializeAdmin = async () => {
    if (!passwordInput.trim()) {
      setErrorMessage("Please type your password into the 'Master Password' box above first, then click Sync.");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    setInfoMessage("Synchronizing master admin account with Supabase...");

    try {
      const res = await fetch("/api/auth/setup-admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: emailInput.trim(),
          password: passwordInput,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to initialize admin account.");
      }

      setInfoMessage(`✓ ${data.message} Logging you in now...`);

      // Auto login right away
      if (supabase && passwordInput) {
        const { error } = await supabase.auth.signInWithPassword({
          email: PRIMARY_ADMIN_EMAIL,
          password: passwordInput,
        });
        if (error) {
          setInfoMessage("Admin account ready. Please enter your password above and click Sign In.");
        }
      }
    } catch (err: any) {
      setErrorMessage(`Setup error: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase || !emailInput.trim()) return;

    setIsSubmitting(true);
    setErrorMessage(null);
    setInfoMessage(null);

    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: emailInput.trim(),
        options: {
          emailRedirectTo: typeof window !== "undefined" ? window.location.origin : undefined,
        },
      });

      if (error) throw error;

      setOtpSent(true);
      setInfoMessage(`A 6-digit confirmation code (or login link) has been sent to ${emailInput}. Enter the code below to log in.`);
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to send login code. Please check your email address.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase || !emailInput.trim() || !otpInput.trim()) return;

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const { error } = await supabase.auth.verifyOtp({
        email: emailInput.trim(),
        token: otpInput.trim(),
        type: "email",
      });

      if (error) throw error;
    } catch (err: any) {
      setErrorMessage(err.message || "Invalid or expired code. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoogleLogin = async () => {
    if (!supabase) return;
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: typeof window !== "undefined" ? window.location.origin : undefined,
        },
      });
      if (error) throw error;
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to initiate Google sign-in.");
      setIsSubmitting(false);
    }
  };

  const handleSignOut = async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    setUser(null);
    setOtpSent(false);
    setOtpInput("");
    setInfoMessage(null);
    setErrorMessage(null);
  };

  // If Supabase is not configured yet (no keys), render content with warning banner
  if (!supabase) {
    return (
      <>
        <div className="mb-6 p-4 border-2 border-amber-600 bg-amber-50 text-amber-900 font-mono text-xs">
          <strong>[ NOTICE: SUPABASE AUTH NOT CONFIGURED ]</strong>
          <p className="mt-1">
            Add <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to your environment variables to enable authentication.
          </p>
        </div>
        {children}
      </>
    );
  }

  // Loading spinner
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] font-mono">
        <div className="border-2 border-slate-900 bg-white p-8 shadow-[4px_4px_0px_#0f172a] text-center max-w-sm w-full">
          <div className="inline-block w-6 h-6 border-2 border-slate-900 border-t-transparent animate-spin mb-4" />
          <p className="text-xs font-bold uppercase tracking-wider text-slate-800">
            [ VERIFYING SECURITY CREDENTIALS... ]
          </p>
        </div>
      </div>
    );
  }

  // 1. User is signed in: Check Whitelist Authorization
  if (user) {
    const isAuthorized = isEmailAuthorized(user.email);

    if (!isAuthorized) {
      return (
        <div className="max-w-xl mx-auto my-12 p-8 border-2 border-red-600 bg-white shadow-[6px_6px_0px_#dc2626] font-mono">
          <div className="inline-block bg-red-600 text-white text-xs font-bold px-2.5 py-1 mb-4 uppercase">
            [ 403 ACCESS FORBIDDEN: UNAUTHORIZED USER ]
          </div>
          <h2 className="text-lg font-bold text-slate-900 mb-2 uppercase">
            Access Restricted to Approved Personnel
          </h2>
          <p className="text-xs text-slate-600 mb-4 leading-relaxed font-sans">
            You are signed in as <strong className="text-slate-900 font-mono">{user.email}</strong>. 
            This deployment is strictly private and reserved for the administrator.
          </p>

          <div className="p-3 bg-red-50 border border-red-300 text-red-900 text-xs mb-6 space-y-1">
            <p><strong>Status:</strong> Rejected by authorization policy.</p>
            <p><strong>Authorized Administrator:</strong> <code>{PRIMARY_ADMIN_EMAIL}</code></p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={handleSignOut}
              className="px-4 py-2 bg-slate-900 hover:bg-red-700 text-white font-mono text-xs font-bold uppercase border-2 border-slate-900 transition-colors shadow-[2px_2px_0px_#000]"
            >
              [ Sign Out & Switch Account ]
            </button>
          </div>
        </div>
      );
    }

    // Authorized! Render normal application
    return <>{children}</>;
  }

  // 2. User is NOT signed in: Render Modern Brutalist Auth Gate
  return (
    <div className="max-w-md mx-auto my-8 border-2 border-slate-900 bg-white shadow-[6px_6px_0px_#0f172a] font-mono">
      {/* Top Header */}
      <div className="bg-slate-900 text-white p-4 border-b-2 border-slate-900">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-widest text-emerald-400">
            [ PRIVATE SYSTEM ACCESS ]
          </span>
          <span className="text-[10px] bg-slate-800 px-2 py-0.5 border border-slate-700 text-slate-300">
            ADMIN ONLY
          </span>
        </div>
        <h1 className="text-base font-bold mt-2 uppercase tracking-tight text-white font-sans">
          Sign In to Access QnA Generator
        </h1>
        <p className="text-xs text-slate-400 mt-1 font-sans">
          This system is private and restricted strictly to <strong>{PRIMARY_ADMIN_EMAIL}</strong>.
        </p>
      </div>

      <div className="p-6">
        {/* Alerts */}
        {errorMessage && (
          <div className="mb-5 p-3 bg-red-50 border-2 border-red-600 text-red-900 text-xs font-mono">
            <strong>[ ERROR ]:</strong> {errorMessage}
          </div>
        )}
        {infoMessage && (
          <div className="mb-5 p-3 bg-emerald-50 border-2 border-emerald-600 text-emerald-900 text-xs font-mono">
            <strong>[ INFO ]:</strong> {infoMessage}
          </div>
        )}

        {/* Tab Switcher: Password (Default) vs 6-Digit Code */}
        <div className="flex border-2 border-slate-900 mb-4 bg-slate-100">
          <button
            type="button"
            onClick={() => {
              setAuthMode("password");
              setErrorMessage(null);
            }}
            className={`flex-1 py-1.5 text-xs font-mono font-bold uppercase transition-colors ${
              authMode === "password"
                ? "bg-slate-900 text-white"
                : "text-slate-700 hover:bg-slate-200"
            }`}
          >
            [ Master Password ]
          </button>
          <button
            type="button"
            onClick={() => {
              setAuthMode("otp");
              setErrorMessage(null);
            }}
            className={`flex-1 py-1.5 text-xs font-mono font-bold uppercase transition-colors ${
              authMode === "otp"
                ? "bg-slate-900 text-white"
                : "text-slate-700 hover:bg-slate-200"
            }`}
          >
            [ Email OTP Code ]
          </button>
        </div>

        {/* Mode 1: Password (Default) */}
        {authMode === "password" && (
          <form onSubmit={handlePasswordLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-mono uppercase font-bold text-slate-800 mb-1">
                Admin Email:
              </label>
              <input
                type="email"
                required
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                placeholder={PRIMARY_ADMIN_EMAIL}
                className="w-full px-3 py-2 border-2 border-slate-900 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-blue-600 rounded-none bg-slate-50"
              />
            </div>
            <div>
              <label className="block text-xs font-mono uppercase font-bold text-slate-800 mb-1">
                Master Password:
              </label>
              <input
                type="password"
                required
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                placeholder="Enter password..."
                className="w-full px-3 py-2 border-2 border-slate-900 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-blue-600 rounded-none bg-slate-50"
              />
              <p className="text-[11px] text-slate-500 mt-1 font-sans">
                First time? Enter your desired password and click Sign In—it will be automatically created and confirmed.
              </p>
            </div>

            <button
              type="submit"
              disabled={isSubmitting || !emailInput.trim() || !passwordInput}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-mono text-xs font-bold uppercase border-2 border-slate-900 shadow-[3px_3px_0px_#0f172a] transition-all"
            >
              {isSubmitting ? "[ VERIFYING / INITIALIZING... ]" : "[ SIGN IN WITH PASSWORD ]"}
            </button>

            <div className="pt-2 text-center">
              <button
                type="button"
                onClick={handleInitializeAdmin}
                className="text-[11px] text-slate-500 hover:text-slate-900 underline font-mono"
              >
                Sync master password with Supabase
              </button>
            </div>
          </form>
        )}

        {/* Mode 2: 6-digit Code (OTP) */}
        {authMode === "otp" && (
          <div>
            {!otpSent ? (
              <form onSubmit={handleSendOtp} className="space-y-4">
                <div>
                  <label className="block text-xs font-mono uppercase font-bold text-slate-800 mb-1">
                    Enter Admin Email:
                  </label>
                  <input
                    type="email"
                    required
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    placeholder={PRIMARY_ADMIN_EMAIL}
                    className="w-full px-3 py-2 border-2 border-slate-900 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-blue-600 rounded-none bg-slate-50"
                  />
                  <p className="text-[11px] text-slate-500 mt-1 font-sans">
                    A 6-digit login code will be sent to your inbox.
                  </p>
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting || !emailInput.trim()}
                  className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-mono text-xs font-bold uppercase border-2 border-slate-900 shadow-[3px_3px_0px_#0f172a] transition-all"
                >
                  {isSubmitting ? "[ SENDING CODE... ]" : "[ SEND 6-DIGIT CODE ]"}
                </button>
              </form>
            ) : (
              <form onSubmit={handleVerifyOtp} className="space-y-4">
                <div>
                  <label className="block text-xs font-mono uppercase font-bold text-slate-800 mb-1">
                    Enter 6-Digit Code for {emailInput}:
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={10}
                    value={otpInput}
                    onChange={(e) => setOtpInput(e.target.value)}
                    placeholder="123456"
                    className="w-full px-3 py-2 border-2 border-slate-900 text-center text-lg font-mono tracking-widest focus:outline-none focus:ring-1 focus:ring-blue-600 rounded-none bg-slate-50"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting || !otpInput.trim()}
                  className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-mono text-xs font-bold uppercase border-2 border-slate-900 shadow-[3px_3px_0px_#0f172a] transition-all"
                >
                  {isSubmitting ? "[ VERIFYING... ]" : "[ VERIFY & ENTER ]"}
                </button>

                <div className="flex justify-between items-center text-xs font-mono pt-2">
                  <button
                    type="button"
                    onClick={() => setOtpSent(false)}
                    className="text-slate-600 hover:text-slate-900 underline"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={handleSendOtp}
                    disabled={isSubmitting}
                    className="text-blue-600 hover:text-blue-800 underline"
                  >
                    Resend Code
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        {/* Quick Google Sign In */}
        <div className="mt-5 pt-4 border-t border-slate-200">
          <button
            type="button"
            onClick={handleGoogleLogin}
            disabled={isSubmitting}
            className="w-full py-2 px-3 bg-white hover:bg-slate-50 text-slate-800 font-mono text-xs font-bold uppercase border border-slate-400 transition-colors flex items-center justify-center gap-2"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.8-2.4 3.65v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.14z"
              />
              <path
                fill="#34A853"
                d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.26v3.15C3.27 21.36 7.36 24 12 24z"
              />
              <path
                fill="#FBBC05"
                d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.26C.46 8.17 0 9.99 0 12s.46 3.83 1.26 5.42l4.02-3.15z"
              />
              <path
                fill="#EA4335"
                d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.36 0 3.27 2.64 1.26 6.58l4.02 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
              />
            </svg>
            [ Sign in with Google (xhieupeo@gmail.com) ]
          </button>
        </div>
      </div>

      {/* Footer Notice */}
      <div className="bg-slate-100 p-3 border-t border-slate-200 text-[11px] text-slate-500 font-mono">
        Authorized Master Account: <code>{PRIMARY_ADMIN_EMAIL}</code>. All unauthorized access attempts are blocked.
      </div>
    </div>
  );
}
