export default function PageLoader() {
  return (
    <div className="mx-auto flex min-h-screen max-w-[430px] flex-col items-center justify-center bg-white px-6">
      <div
        className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--color-border)] border-t-[var(--color-accent)]"
        role="status"
        aria-label="Loading"
      />
      <p className="mt-4 text-sm text-[var(--color-text-muted)]">Loading…</p>
    </div>
  );
}
