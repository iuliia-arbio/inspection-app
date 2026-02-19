"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import type { DealWithApartments } from "@/lib/types";

export default function UnitSelectionClient({
  deal,
}: {
  deal: DealWithApartments | null;
}) {
  const router = useRouter();
  const [includeSharedAreas, setIncludeSharedAreas] = useState(true);
  const [selectedUnits, setSelectedUnits] = useState<string[]>([]);
  const [isStarting, setIsStarting] = useState(false);

  if (!deal) {
    return (
      <div className="mx-auto flex min-h-screen max-w-[430px] flex-col items-center justify-center gap-4 px-6">
        <p className="text-[var(--color-text-muted)]">Deal not found</p>
        <Link
          href="/"
          className="font-semibold text-[var(--color-accent)] underline"
        >
          Back to deals
        </Link>
      </div>
    );
  }

  const toggleUnit = (unitId: string) => {
    setSelectedUnits((prev) =>
      prev.includes(unitId) ? prev.filter((id) => id !== unitId) : [...prev, unitId]
    );
  };

  const handleStartInspection = async () => {
    if (!includeSharedAreas && selectedUnits.length === 0) return;
    setIsStarting(true);
    const unitConfigs: Record<string, { bedrooms: number; bathrooms: number; living_rooms: number; kitchen: number; balcony: number }> = {};
    for (const id of selectedUnits) {
      unitConfigs[id] = { bedrooms: 1, bathrooms: 1, living_rooms: 0, kitchen: 1, balcony: 0 };
    }
    const res = await fetch("/api/inspections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dealId: deal.id,
        selectedUnitIds: selectedUnits,
        unitConfigs,
        includeSharedAreas,
      }),
    });
    const { inspectionId } = await res.json();
    setIsStarting(false);

    const id = inspectionId ?? `demo-${crypto.randomUUID()}`;
    if (!inspectionId) {
      sessionStorage.setItem(
        `inspection-${id}`,
        JSON.stringify({ selectedUnitIds: selectedUnits, unitConfigs, includeSharedAreas })
      );
    }
    router.push(`/inspect/${deal.id}/${id}`);
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-[430px] flex-col bg-white">
      <header className="sticky top-0 z-50 border-b border-[var(--color-border)] bg-white px-6 py-5">
        <p className="break-words text-[11px] font-semibold uppercase tracking-widest text-[var(--color-text-muted)]">
          {deal.deal_sku}
        </p>
        <h1 className="mt-1.5 text-2xl font-bold tracking-tight text-[var(--color-primary)]">
          Select Units
        </h1>
      </header>

      <main className="flex-1 px-6 py-6 pb-32">
        <div
          className={`mb-6 rounded-2xl border p-5 transition-all cursor-pointer ${
            includeSharedAreas
              ? "border-[var(--color-accent)] bg-[#f9fce8]"
              : "border-[var(--color-border)] bg-white"
          }`}
          onClick={() => setIncludeSharedAreas((prev) => !prev)}
        >
          <div className="flex items-center gap-3">
            <div
              className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md border-2 transition-all ${
                includeSharedAreas
                  ? "border-[var(--color-accent)] bg-[var(--color-accent)]"
                  : "border-[var(--color-border)] bg-white"
              }`}
            >
              {includeSharedAreas && (
                <span className="text-sm font-bold text-[var(--color-primary)]">
                  ✓
                </span>
              )}
            </div>
            <div>
              <h3 className="text-[17px] font-semibold text-[var(--color-primary)]">
                Shared Areas
              </h3>
              <p className="text-sm text-[var(--color-text-muted)]">
                Exterior, common areas (inspected once)
              </p>
            </div>
          </div>
        </div>

        <p className="mb-3 text-sm font-semibold text-[var(--color-primary)]">
          Individual units
        </p>

        <div className="flex flex-col gap-3">
          {deal.apartments.map((unit) => {
            const isSelected = selectedUnits.includes(unit.id);

            return (
              <div
                key={unit.id}
                className={`rounded-2xl border p-5 transition-all ${
                  isSelected
                    ? "border-[var(--color-accent)] bg-[#f9fce8]"
                    : "border-[var(--color-border)] bg-white"
                }`}
              >
                <div
                  className="flex cursor-pointer items-center gap-3"
                  onClick={() => toggleUnit(unit.id)}
                >
                  <div
                    className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md border-2 transition-all ${
                      isSelected
                        ? "border-[var(--color-accent)] bg-[var(--color-accent)]"
                        : "border-[var(--color-border)] bg-white"
                    }`}
                  >
                    {isSelected && (
                      <span className="text-sm font-bold text-[var(--color-primary)]">
                        ✓
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="break-words text-[17px] font-semibold text-[var(--color-primary)]">
                      Unit {unit.apartment_sku}
                    </h3>
                    {unit.issues?.length > 0 && (
                      <p className="text-sm text-[var(--color-text-muted)]">
                        {unit.issues.length} known issue
                        {unit.issues.length !== 1 ? "s" : ""}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-7 flex flex-col gap-3">
          <button
            type="button"
            disabled={(!includeSharedAreas && selectedUnits.length === 0) || isStarting}
            onClick={handleStartInspection}
            className="w-full rounded-xl bg-[var(--color-accent)] py-4 text-[15px] font-semibold text-[var(--color-primary)] transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isStarting
              ? "Starting…"
              : `Start Inspection${includeSharedAreas || selectedUnits.length > 0 ? ` (${[includeSharedAreas && "shared", selectedUnits.length > 0 && `${selectedUnits.length} unit${selectedUnits.length !== 1 ? "s" : ""}`].filter(Boolean).join(", ")})` : ""}`}
          </button>
          <Link
            href="/"
            className="block w-full rounded-xl bg-[var(--color-bg-light)] py-4 text-center text-[15px] font-semibold text-[var(--color-primary)]"
          >
            Back
          </Link>
        </div>
      </main>
    </div>
  );
}
