"use client";

export function PrintButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      data-testid="print"
      className="min-h-12 rounded-full bg-brand-600 px-8 text-lg font-semibold text-white hover:bg-brand-700 print:hidden"
    >
      🖨️ {label}
    </button>
  );
}
