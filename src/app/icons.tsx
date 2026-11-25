import type { ReactNode } from 'react';

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function LogoMark() {
  return (
    <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="13" fill="var(--accent-wash)" stroke="var(--accent)" strokeWidth="2" />
      <path
        d="M16 3c-5 4-7 9-7 13s2 9 7 13M16 3c5 4 7 9 7 13s-2 9-7 13M16 9v20"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** An arrow pointer. */
export function SelectIcon() {
  return (
    <Icon>
      <path d="M6 3.5l12.5 8-5.6 1.3 3.2 6-2.3 1.2-3.2-6L6.6 18z" />
    </Icon>
  );
}

/** A board lying flat, seen from above and to one side. */
export function BoardIcon() {
  return (
    <Icon>
      <path d="M3 10.5L13.5 6 21 9.5 10.5 14z" />
      <path d="M3 10.5v3.2l7.5 3.6V14M21 9.5v3.2l-10.5 4.6" />
    </Icon>
  );
}

/** A cabinet seen from the front: two doors on a recessed base. */
export function CabinetIcon() {
  return (
    <Icon>
      <rect x="4.5" y="3.5" width="15" height="14.5" rx="1" />
      <path d="M12 3.5V18M9.5 10v2.2M14.5 10v2.2M6.5 18v2.5h11V18" />
    </Icon>
  );
}

/** A block with an arrow drawing one face outward. */
export function PullIcon() {
  return (
    <Icon>
      <path d="M3 13.5L10 11l7 2.5-7 2.5z" />
      <path d="M3 13.5v4L10 20v-4M17 13.5v4L10 20" />
      <path d="M10 10V3M7.5 5.5L10 3l2.5 2.5" />
    </Icon>
  );
}

/** A square with an arrow carrying it to a new place. */
export function MoveIcon() {
  return (
    <Icon>
      <rect x="3" y="12" width="8" height="8" rx="1" strokeDasharray="2.2 2.2" />
      <rect x="13" y="4" width="8" height="8" rx="1" />
      <path d="M8 15l5-4.5M13 13.2v-2.7h-2.7" />
    </Icon>
  );
}

/** An arrow sweeping a quarter of the way around a point. */
export function RotateIcon() {
  return (
    <Icon>
      <path d="M5 19V8M5 19h11" />
      <path d="M9 6.2a11 11 0 0 1 8.8 8.8" />
      <path d="M15.2 13.3l2.7 1.9 1.7-2.8" />
      <circle cx="5" cy="19" r="1.1" fill="currentColor" stroke="none" />
    </Icon>
  );
}

/** A tape measure with its blade pulled out. */
export function TapeIcon() {
  return (
    <Icon>
      <rect x="3" y="6" width="11" height="11" rx="2.5" />
      <circle cx="8.5" cy="11.5" r="2" />
      <path d="M14 17h7v-3M17.5 17v-1.5" />
    </Icon>
  );
}

export function UndoIcon() {
  return (
    <Icon>
      <path d="M8 6L4 10l4 4" />
      <path d="M4 10h10a5 5 0 0 1 0 10h-3" />
    </Icon>
  );
}

export function RedoIcon() {
  return (
    <Icon>
      <path d="M16 6l4 4-4 4" />
      <path d="M20 10H10a5 5 0 0 0 0 10h3" />
    </Icon>
  );
}

/** A ball with a ring swinging around it. */
export function OrbitIcon() {
  return (
    <Icon>
      <circle cx="12" cy="12" r="3.2" />
      <ellipse cx="12" cy="12" rx="9.6" ry="3.9" transform="rotate(-28 12 12)" />
    </Icon>
  );
}

/** Arrows in four directions. */
export function PanIcon() {
  return (
    <Icon>
      <path d="M12 3v18M3 12h18" />
      <path d="M9.5 5.5L12 3l2.5 2.5M9.5 18.5L12 21l2.5-2.5M5.5 9.5L3 12l2.5 2.5M18.5 9.5L21 12l-2.5 2.5" />
    </Icon>
  );
}

/** Corner brackets closing in on a box. */
export function FitIcon() {
  return (
    <Icon>
      <path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4" />
      <rect x="9" y="9" width="6" height="6" rx="0.8" />
    </Icon>
  );
}

export function HelpIcon() {
  return (
    <Icon>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.6 9.3a2.5 2.5 0 1 1 3.6 2.3c-.8.4-1.2 1-1.2 1.9" />
      <circle cx="12" cy="16.6" r="0.6" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function CloseIcon() {
  return (
    <Icon>
      <path d="M6 6l12 12M18 6L6 18" />
    </Icon>
  );
}
