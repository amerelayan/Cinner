"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import FilmReelIcon from "@/components/FilmReelIcon";

const BUTTON_FONT = "font-display tracking-[0.1em]";
const NAV_LINK =
  "relative pb-1 transition-colors hover:text-foreground after:absolute after:bottom-0 after:left-0 after:h-[2px] after:w-0 after:bg-accent after:transition-all after:duration-300 hover:after:w-full";

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
        <Link href="/" className="flex items-center gap-2" style={{ color: "#e0262e" }}>
          <FilmReelIcon className="h-5 w-5" />
          <span className="font-display text-xl tracking-[0.15em]">CINNER</span>
        </Link>

        <nav className="hidden items-center gap-6 text-sm tracking-wide text-muted sm:flex">
          <Link href="/search" className={NAV_LINK}>
            MOVIES
          </Link>
          <Link href="/pick-for-me" className={NAV_LINK}>
            PICK FOR ME
          </Link>
          {loggedIn && (
            <>
              <Link href="/for-you" className={NAV_LINK}>
                FOR YOU
              </Link>
              <Link href="/profile" className={NAV_LINK}>
                PROFILE
              </Link>
            </>
          )}
        </nav>

        <div className="flex items-center gap-3">
          {loggedIn === true && (
            <>
              <Link
                href="/profile"
                className={`text-sm text-muted sm:hidden ${NAV_LINK}`}
              >
                PROFILE
              </Link>
              <button
                onClick={handleLogout}
                className={`rounded border border-border px-4 py-1.5 text-sm text-foreground transition-colors hover:border-accent ${BUTTON_FONT}`}
              >
                LOG OUT
              </button>
            </>
          )}
          {loggedIn === false && (
            <>
              <Link
                href="/login"
                className={`rounded border border-border px-4 py-1.5 text-sm text-foreground transition-colors hover:border-accent ${BUTTON_FONT}`}
              >
                LOG IN
              </Link>
              <Link
                href="/signup"
                className={`rounded bg-accent px-4 py-1.5 text-sm text-white transition-colors hover:bg-accent-hover ${BUTTON_FONT}`}
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
