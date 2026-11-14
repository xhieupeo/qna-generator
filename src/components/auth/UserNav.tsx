"use client";

import React, { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";

export function UserNav() {
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    if (!supabase) return;

    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user || null);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user || null);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const handleSignOut = async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    window.location.reload();
  };

  if (!supabase || !user) {
    return null;
  }

  const shortEmail = user.email || "User";

  return (
    <div className="flex items-center gap-2 font-mono text-xs">
      <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 bg-slate-100 border border-slate-300 text-slate-800 font-bold">
        <span className="w-2 h-2 bg-emerald-500 inline-block" />
        <span className="truncate max-w-[180px]">{shortEmail}</span>
      </div>
      <button
        type="button"
        onClick={handleSignOut}
        className="px-2.5 py-1 bg-white hover:bg-red-50 text-slate-700 hover:text-red-700 font-bold border border-slate-900 transition-colors uppercase text-[11px]"
      >
        [ Sign Out ]
      </button>
    </div>
  );
}

