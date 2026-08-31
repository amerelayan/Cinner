"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export default function NavBar() {
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setLoggedIn(!!data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setLoggedIn(!!session);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  async function handleLogout() {
    await supabase.auth.signOut();
    window.location.href = "/";
  }

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur-sm">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
        <Link href="/" className="font-display text-xl tracking-[0.15em] text-accent">
          CINNER
        </Link>

        <nav className="hidden items-center gap-6 text-sm tracking-wide text-muted sm:flex">
          <Link href="/search" className="transition-colors hover:text-foreground">
            MOVIES
          </Link>
          {loggedIn && (
            <Link href="/profile" className="transition-colors hover:text-foreground">
              PROFILE
            </Link>
          )}
        </nav>

        <div className="flex items-center gap-3">
          {loggedIn === true && (
            <>
              <Link
                href="/profile"
                className="text-sm text-muted transition-colors hover:text-foreground sm:hidden"
              >
                PROFILE
              </Link>
              <button
                onClick={handleLogout}
                className="rounded border border-border px-4 py-1.5 text-sm tracking-wide text-foreground transition-colors hover:border-accent"
              >
                LOG OUT
              </button>
            </>
          )}
          {loggedIn === false && (
            <>
              <Link
                href="/login"
                className="rounded border border-border px-4 py-1.5 text-sm tracking-wide text-foreground transition-colors hover:border-accent"
              >
                LOG IN
              </Link>
              <Link
                href="/signup"
                className="rounded bg-accent px-4 py-1.5 text-sm font-medium tracking-wide text-white transition-colors hover:bg-accent-hover"
              >
                SIGN UP
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
