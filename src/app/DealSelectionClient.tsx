"use client";

import Link from "next/link";
import { useState, useMemo } from "react";
import type { DealWithApartments } from "@/lib/types";

export default function DealSelectionClient({
  deals,
}: {
  deals: DealWithApartments[];
}) {
  const [query, setQuery] = useState("");

  const filteredDeals = useMemo(() => {
    if (!query.trim()) return deals;
    const q = query.trim().toLowerCase();
    return deals.filter((deal) =>
      deal.deal_sku.toLowerCase().includes(q)
    );
  }, [deals, query]);

  return (
    <div className="mx-auto flex min-h-screen max-w-[430px] flex-col bg-white">
      <header className="sticky top-0 z-50 border-b border-[var(--color-border)] bg-white px-6 py-5">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-[var(--color-text-muted)]">
          Inspection Tool
        </p>
        <h1 className="mt-1.5 text-2xl font-bold tracking-tight text-[var(--color-primary)]">
          Select Deal
        </h1>
        <div className="mt-4">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search deals…"
            autoComplete="off"
            className="w-full min-h-[44px] rounded-xl border-2 border-[var(--color-border)] bg-[var(--color-bg-light)] px-4 py-3 text-[15px] text-[var(--color-primary)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
            aria-label="Search deals"
          />
        </div>
      </header>

      <main className="flex-1 px-6 py-6 pb-60">
        <div className="flex flex-col gap-3">
          {filteredDeals.length === 0 ? (
            <p className="py-8 text-center text-sm text-[var(--color-text-muted)]">
              {query.trim() ? "No deals match your search" : "No deals available"}
            </p>
          ) : (
            filteredDeals.map((deal) => (
              <Link
                key={deal.id}
                href={`/inspect/${deal.id}`}
                className="rounded-2xl border border-[var(--color-border)] bg-white p-5 shadow-sm transition-all hover:border-[var(--color-accent)] hover:bg-[#f9fce8]"
              >
                <h3 className="break-words text-[17px] font-semibold text-[var(--color-primary)]">
                  {deal.deal_sku}
                </h3>
                <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                  {deal.apartments.length} unit
                  {deal.apartments.length !== 1 ? "s" : ""}
                </p>
              </Link>
            ))
          )}
        </div>
      </main>
    </div>
  );
}
