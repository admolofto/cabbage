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
