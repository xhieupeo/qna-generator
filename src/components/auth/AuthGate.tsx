"use client";

import React, { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { isEmailAuthorized, getAllowedEmailsList } from "@/lib/auth-whitelist";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<any>(null);
  const [emailInput, setEmailInput] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [otpInput, setOtpInput] = useState("");
  const [authMode, setAuthMode] = useState<"otp" | "password">("otp");
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

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase || !emailInput.trim() || !passwordInput) return;

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: emailInput.trim(),
        password: passwordInput,
      });

      if (error) throw error;
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to sign in. Check your email and password.");
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
            Add <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to your environment variables to enable authentication and the email whitelist.
          </p>
        </div>
        {children}
      </>
    );
  }

  // Loading spinner / placeholder
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
      const whitelist = getAllowedEmailsList();
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
            This email is not listed in the approved whitelist for this deployment.
          </p>

          <div className="p-3 bg-red-50 border border-red-300 text-red-900 text-xs mb-6 space-y-1">
            <p><strong>Status:</strong> Rejected by authorization policy.</p>
            <p><strong>Required:</strong> Please contact the site owner to add your email to <code>ALLOWED_EMAILS</code>.</p>
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
            [ AUTHENTICATION GATE ]
          </span>
          <span className="text-[10px] bg-slate-800 px-2 py-0.5 border border-slate-700 text-slate-300">
            RESTRICTED ACCESS
          </span>
        </div>
        <h1 className="text-base font-bold mt-2 uppercase tracking-tight text-white font-sans">
          Sign In to Access QnA Generator
        </h1>
        <p className="text-xs text-slate-400 mt-1 font-sans">
          Only authorized emails listed in the platform whitelist may generate and save exams.
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

        {/* Quick Google Sign In */}
        <button
          type="button"
          onClick={handleGoogleLogin}
          disabled={isSubmitting}
          className="w-full mb-5 py-2.5 px-4 bg-white hover:bg-slate-50 text-slate-900 font-mono text-xs font-bold uppercase border-2 border-slate-900 shadow-[3px_3px_0px_#0f172a] transition-all flex items-center justify-center gap-2"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24">
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
          [ Sign in with Google ]
        </button>

        <div className="relative flex items-center justify-center my-4">
          <div className="border-t border-slate-300 w-full" />
          <span className="bg-white px-2 text-[11px] font-mono uppercase text-slate-500 absolute">
            OR USE EMAIL CODE
          </span>
        </div>

        {/* Tab Switcher: 6-Digit OTP Code vs Password */}
        <div className="flex border-2 border-slate-900 mb-4 bg-slate-100">
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
            [ 6-Digit Code / Link ]
          </button>
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
            [ Password ]
          </button>
        </div>

        {/* Mode 1: 6-digit Code (OTP) */}
        {authMode === "otp" && (
          <div>
            {!otpSent ? (
              <form onSubmit={handleSendOtp} className="space-y-4">
                <div>
                  <label className="block text-xs font-mono uppercase font-bold text-slate-800 mb-1">
                    Enter Authorized Email:
                  </label>
                  <input
                    type="email"
                    required
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    placeholder="student@fpt.edu.vn"
                    className="w-full px-3 py-2 border-2 border-slate-900 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-blue-600 rounded-none bg-slate-50"
                  />
                  <p className="text-[11px] text-slate-500 mt-1 font-sans">
                    We will send a 6-digit login code to this address. No password required.
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
                    Change Email
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

        {/* Mode 2: Password */}
        {authMode === "password" && (
          <form onSubmit={handlePasswordLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-mono uppercase font-bold text-slate-800 mb-1">
                Authorized Email:
              </label>
              <input
                type="email"
                required
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                placeholder="student@fpt.edu.vn"
                className="w-full px-3 py-2 border-2 border-slate-900 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-blue-600 rounded-none bg-slate-50"
              />
            </div>
            <div>
              <label className="block text-xs font-mono uppercase font-bold text-slate-800 mb-1">
                Password:
              </label>
              <input
                type="password"
                required
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                placeholder="••••••••"
                className="w-full px-3 py-2 border-2 border-slate-900 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-blue-600 rounded-none bg-slate-50"
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting || !emailInput.trim() || !passwordInput}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-mono text-xs font-bold uppercase border-2 border-slate-900 shadow-[3px_3px_0px_#0f172a] transition-all"
            >
              {isSubmitting ? "[ SIGNING IN... ]" : "[ SIGN IN WITH PASSWORD ]"}
            </button>
          </form>
        )}
      </div>

      {/* Footer Notice */}
      <div className="bg-slate-100 p-3 border-t border-slate-200 text-[11px] text-slate-500 font-mono">
        Whitelisted deployments only permit verified accounts. Non-whitelisted attempts will be rejected.
      </div>
    </div>
  );
}
