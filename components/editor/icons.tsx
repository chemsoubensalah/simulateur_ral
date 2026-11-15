import type { SVGProps } from "react";

const base = (props: SVGProps<SVGSVGElement>) => ({
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  width: 22,
  height: 22,
  ...props,
});

export const BrushIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M18.4 3.6a2 2 0 0 1 2.8 2.8L12 15.6 8.4 12z" /><path d="M8.4 12c-2.5 0-4.4 1.8-4.4 4.2 0 1.6-.8 2.6-2 3.2 1.4 1.1 3.4 1.6 5.2 1.6 3 0 5-2.3 4.8-5.4" /></svg>
);
export const EraserIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="m7 21-4.3-4.3a1.5 1.5 0 0 1 0-2.1L13.6 3.7a1.5 1.5 0 0 1 2.1 0l4.6 4.6a1.5 1.5 0 0 1 0 2.1L10.4 20.3" /><path d="M7 21h14M6 12l6 6" /></svg>
);
export const LassoIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M4 7 11 3l9 5-3 9-10 1z" strokeDasharray="2.5 2.5" /><circle cx="4" cy="7" r="1.5" fill="currentColor" /><circle cx="11" cy="3" r="1.5" fill="currentColor" /><circle cx="20" cy="8" r="1.5" fill="currentColor" /><circle cx="17" cy="17" r="1.5" fill="currentColor" /><circle cx="7" cy="18" r="1.5" fill="currentColor" /></svg>
);
export const PanIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M12 2v20M2 12h20M12 2l-3 3M12 2l3 3M12 22l-3-3M12 22l3-3M2 12l3-3M2 12l3 3M22 12l-3-3M22 12l-3 3" /></svg>
);
export const UndoIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></svg>
);
export const RedoIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="m15 14 5-5-5-5" /><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" /></svg>
);
export const EyeIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>
);
export const EyeOffIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M3 3l18 18M10.6 5.1A10.6 10.6 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7a10 10 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2" /></svg>
);
export const TrashIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" /></svg>
);
export const PlusIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M12 5v14M5 12h14" /></svg>
);
export const MinusIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M5 12h14" /></svg>
);
export const CompareIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M12 2v20" /></svg>
);
export const DownloadIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M12 3v12m0 0-5-5m5 5 5-5M4 21h16" /></svg>
);
export const FitIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>
);
export const MaskIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><rect x="3" y="3" width="18" height="18" rx="2" strokeDasharray="3 2.5" /><path d="M7 17 17 7M7 12l5-5M12 17l5-5" /></svg>
);
export const ImageIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="m21 16-5-5-9 9" /></svg>
);
export const CameraIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" /><circle cx="12" cy="13" r="3.5" /></svg>
);
export const SparkleIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" /><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" /></svg>
);
export const SpinnerIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} className={`animate-spin ${p.className ?? ""}`}><path d="M12 3a9 9 0 1 0 9 9" /></svg>
);
export const CheckIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="m5 12 5 5 9-10" /></svg>
);
