/**
 * OpsDesk's single illustration style: soft rounded shapes on a muted base,
 * one brand-colored accent, hairline strokes. All colors come from theme
 * tokens, so every illustration follows light/dark mode and the tenant's brand.
 * Original artwork (see public/images/CREDITS.md). Decorative: aria-hidden.
 */
import type { SVGProps } from "react";

const base = { viewBox: "0 0 200 160", fill: "none", "aria-hidden": true, focusable: false } as const;
const S = {
  surface: "var(--card)",
  muted: "var(--muted)",
  line: "var(--border)",
  ink: "var(--muted-foreground)",
  brand: "var(--brand)",
  brandSoft: "color-mix(in oklch, var(--brand) 18%, transparent)",
};

function Ground() {
  return <ellipse cx="100" cy="140" rx="72" ry="8" fill={S.muted} />;
}

export function JobsIllustration(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <Ground />
      <rect x="52" y="22" width="84" height="108" rx="12" fill={S.surface} stroke={S.line} strokeWidth="2" />
      <rect x="78" y="14" width="32" height="16" rx="6" fill={S.brand} />
      {[48, 70, 92].map((y, i) => (
        <g key={y}>
          <rect x="66" y={y} width="12" height="12" rx="3.5" fill={i === 0 ? S.brand : S.muted} />
          {i === 0 && (
            <path
              d={`M69 ${y + 6}l2.5 2.5 4-5`}
              stroke="var(--brand-foreground)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
          <rect x="84" y={y + 2} width={i === 1 ? 30 : 40} height="8" rx="4" fill={S.muted} />
        </g>
      ))}
      <g transform="rotate(-35 150 92)">
        <rect
          x="144"
          y="70"
          width="12"
          height="52"
          rx="6"
          fill={S.brandSoft}
          stroke={S.brand}
          strokeWidth="2"
        />
        <circle cx="150" cy="66" r="12" fill={S.surface} stroke={S.brand} strokeWidth="2" />
        <rect x="146" y="52" width="8" height="12" rx="2" fill={S.surface} />
      </g>
    </svg>
  );
}

export function CustomersIllustration(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <Ground />
      <rect x="30" y="44" width="70" height="86" rx="12" fill={S.surface} stroke={S.line} strokeWidth="2" />
      <rect x="100" y="30" width="70" height="100" rx="12" fill={S.surface} stroke={S.line} strokeWidth="2" />
      <circle cx="65" cy="72" r="13" fill={S.muted} />
      <rect x="47" y="94" width="36" height="7" rx="3.5" fill={S.muted} />
      <rect x="53" y="106" width="24" height="6" rx="3" fill={S.muted} />
      <circle cx="135" cy="62" r="15" fill={S.brandSoft} stroke={S.brand} strokeWidth="2" />
      <rect x="113" y="88" width="44" height="8" rx="4" fill={S.brand} />
      <rect x="121" y="101" width="28" height="6" rx="3" fill={S.muted} />
      <rect x="117" y="113" width="36" height="6" rx="3" fill={S.muted} />
    </svg>
  );
}

export function ServicesIllustration(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <Ground />
      <path d="M78 48v-8a8 8 0 0 1 8-8h28a8 8 0 0 1 8 8v8" stroke={S.ink} strokeWidth="3" />
      <rect x="40" y="48" width="120" height="82" rx="14" fill={S.surface} stroke={S.line} strokeWidth="2" />
      <rect x="40" y="48" width="120" height="26" rx="13" fill={S.brandSoft} />
      <rect x="90" y="66" width="20" height="16" rx="5" fill={S.brand} />
      <rect x="58" y="96" width="38" height="8" rx="4" fill={S.muted} />
      <rect x="58" y="110" width="58" height="8" rx="4" fill={S.muted} />
      <circle cx="140" cy="108" r="10" fill={S.muted} />
    </svg>
  );
}

export function TeamIllustration(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <Ground />
      <circle cx="70" cy="66" r="18" fill={S.muted} />
      <path d="M40 130c0-20 13-34 30-34s30 14 30 34" fill={S.muted} />
      <circle cx="130" cy="58" r="20" fill={S.brandSoft} stroke={S.brand} strokeWidth="2" />
      <path d="M96 130c0-23 15-38 34-38s34 15 34 38" fill={S.surface} stroke={S.brand} strokeWidth="2" />
      <circle cx="160" cy="34" r="12" fill={S.brand} />
      <path
        d="M160 28v12M154 34h12"
        stroke="var(--brand-foreground)"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function SearchIllustration(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <Ground />
      <rect x="40" y="30" width="96" height="100" rx="12" fill={S.surface} stroke={S.line} strokeWidth="2" />
      {[50, 66, 82].map((y) => (
        <rect key={y} x="56" y={y} width="64" height="8" rx="4" fill={S.muted} />
      ))}
      <circle cx="128" cy="94" r="22" fill={S.surface} stroke={S.brand} strokeWidth="5" />
      <path d="m144 110 18 18" stroke={S.brand} strokeWidth="7" strokeLinecap="round" />
    </svg>
  );
}

export function ErrorIllustration(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <Ground />
      <path d="M20 96h48" stroke={S.ink} strokeWidth="5" strokeLinecap="round" />
      <rect x="64" y="80" width="30" height="32" rx="8" fill={S.surface} stroke={S.line} strokeWidth="2" />
      <path d="M94 88h10M94 104h10" stroke={S.ink} strokeWidth="4" strokeLinecap="round" />
      <rect
        x="114"
        y="80"
        width="30"
        height="32"
        rx="8"
        fill={S.brandSoft}
        stroke={S.brand}
        strokeWidth="2"
      />
      <path d="M144 96h36" stroke={S.brand} strokeWidth="5" strokeLinecap="round" />
      <path d="m104 62 4 8m6-12v10m8-6-4 8" stroke={S.brand} strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function NotFoundIllustration(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <Ground />
      <path
        d="M36 40 76 28l48 14 40-12v94l-40 12-48-14-40 12z"
        fill={S.surface}
        stroke={S.line}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M76 28v96M124 42v96" stroke={S.line} strokeWidth="2" />
      <path
        d="M50 96c14-6 20-30 40-26s22 24 44 14"
        stroke={S.ink}
        strokeWidth="3"
        strokeDasharray="2 7"
        strokeLinecap="round"
      />
      <path d="M146 64c0 12-12 24-12 24s-12-12-12-24a12 12 0 0 1 24 0Z" fill={S.brand} />
      <circle cx="134" cy="64" r="4.5" fill="var(--brand-foreground)" />
    </svg>
  );
}

/** Larger scene for the auth split screen. */
export function DispatchScene(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 400 300" fill="none" aria-hidden focusable={false} {...props}>
      <ellipse cx="200" cy="268" rx="170" ry="14" fill="oklch(1 0 0 / 0.12)" />
      <rect x="60" y="40" width="200" height="150" rx="18" fill="oklch(1 0 0 / 0.95)" />
      <rect x="60" y="40" width="200" height="34" rx="17" fill="oklch(1 0 0 / 0.6)" />
      {[0, 1, 2, 3].map((i) => (
        <rect
          key={i}
          x={78 + i * 44}
          y="90"
          width="34"
          height={[70, 46, 84, 58][i]}
          rx="8"
          fill={i === 2 ? "var(--brand)" : "oklch(0.92 0.01 270)"}
        />
      ))}
      <rect x="200" y="150" width="160" height="96" rx="18" fill="oklch(1 0 0 / 0.97)" />
      <circle cx="232" cy="182" r="14" fill="color-mix(in oklch, var(--brand) 20%, white)" />
      <rect x="254" y="174" width="80" height="8" rx="4" fill="oklch(0.88 0.01 270)" />
      <rect x="254" y="188" width="54" height="7" rx="3.5" fill="oklch(0.92 0.01 270)" />
      <rect x="220" y="212" width="120" height="20" rx="10" fill="var(--brand)" />
      <path
        d="m272 222 6 6 12-12"
        stroke="white"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="96" cy="230" r="26" fill="oklch(1 0 0 / 0.95)" />
      <path d="M96 216v16l10 6" stroke="var(--brand)" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}
