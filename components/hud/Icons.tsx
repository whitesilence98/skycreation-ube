'use client';

interface IconProps {
  className?: string;
}

const base = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.15,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export function IconCamera({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base} aria-hidden>
      <path d="M3.5 8.5h3l1.4-2h8.2l1.4 2h3v10h-17z" />
      <circle cx="12" cy="13.2" r="3.3" />
    </svg>
  );
}

export function IconAlbum({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base} aria-hidden>
      <rect x="4.2" y="3.5" width="15.6" height="17" rx="1.4" />
      <circle cx="9.2" cy="8.6" r="1.5" />
      <path d="M5 17.2l4.2-4 3.1 2.8 3.2-3.4 3.5 4.6" />
    </svg>
  );
}

export function IconPose({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base} aria-hidden>
      <circle cx="12" cy="4.9" r="1.9" />
      <path d="M12 7.2v6.1M12 13.3l-3.3 6M12 13.3l3.3 6M7.4 9.6l4.6-1.1 4.6 1.1" />
    </svg>
  );
}

export function IconHanger({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base} aria-hidden>
      <path d="M12 3.4a2.1 2.1 0 0 1 2.1 2.1c0 1.4-1.5 1.7-1.5 3" />
      <path d="M12.6 8.5L3.8 14.6c-.8.6-.4 1.9.6 1.9h15.2c1 0 1.4-1.3.6-1.9z" />
    </svg>
  );
}

export function IconFocus({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base} aria-hidden>
      <path d="M4 8.2V5.4c0-.8.6-1.4 1.4-1.4h2.8M20 8.2V5.4c0-.8-.6-1.4-1.4-1.4h-2.8M4 15.8v2.8c0 .8.6 1.4 1.4 1.4h2.8M20 15.8v2.8c0 .8-.6 1.4-1.4 1.4h-2.8" />
      <circle cx="12" cy="12" r="3.3" />
    </svg>
  );
}

export function IconRevert({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base} aria-hidden>
      <path d="M4.4 9.6h9.2a4.6 4.6 0 1 1 0 9.2H8.8" />
      <path d="M7.7 6.3L4.3 9.7l3.4 3.4" />
    </svg>
  );
}

export function IconMouse({ className, filled = false }: IconProps & { filled?: boolean }) {
  return (
    <svg viewBox="0 0 16 22" className={className} {...base} aria-hidden>
      <rect x="1.4" y="1.4" width="13.2" height="19.2" rx="6.4" />
      <path d="M8 1.6v4.6" strokeWidth="1.05" />
      {filled && <rect x="6.4" y="4.2" width="3.2" height="4.2" rx="1.6" fill="currentColor" stroke="none" />}
    </svg>
  );
}

export function IconScroll({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 22" className={className} {...base} aria-hidden>
      <rect x="1.4" y="1.4" width="13.2" height="19.2" rx="6.4" />
      <path d="M8 6.6v4.2M8 9.4l-1.5-1.4M8 9.4l1.5-1.4" strokeWidth="1" />
    </svg>
  );
}

export function IconSparkle({ className }: IconProps) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <path
        d="M16 2c1.1 6.9 3.4 10.6 12 12-8.6 1.4-10.9 5.1-12 12-1.1-6.9-3.4-10.6-12-12 8.6-1.4 10.9-5.1 12-12z"
        fill="currentColor"
      />
    </svg>
  );
}

export function IconChevronLeft({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" className={className} {...base} strokeWidth={1.3} aria-hidden>
      <path d="M10 3.4L4.8 8l5.2 4.6" />
    </svg>
  );
}

export function IconArrowRight({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" className={className} {...base} strokeWidth={1.3} aria-hidden>
      <path d="M2.8 8h10M9.2 4.4L12.8 8l-3.6 3.6" />
    </svg>
  );
}

export function IconCheck({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden>
      <path
        d="M3 8.4l3.1 3.1L13 4.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconMove({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" className={className} {...base} strokeWidth={1.1} aria-hidden>
      <path d="M8 2.2v11.6M2.2 8h11.6M8 2.2L6.2 4M8 2.2L9.8 4M8 13.8l-1.8-1.8M8 13.8l1.8-1.8M2.2 8L4 6.2M2.2 8L4 9.8M13.8 8L12 6.2M13.8 8L12 9.8" />
    </svg>
  );
}

export function IconRotate({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" className={className} {...base} strokeWidth={1.1} aria-hidden>
      <path d="M12.9 9.3A5.2 5.2 0 1 1 11.4 4" />
      <path d="M12.4 2.1l.4 2.8-2.8.3" />
    </svg>
  );
}

export function IconScale({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" className={className} {...base} strokeWidth={1.1} aria-hidden>
      <rect x="2" y="2" width="5.4" height="5.4" rx="0.6" />
      <rect x="8.6" y="8.6" width="5.4" height="5.4" rx="0.6" />
      <path d="M8.2 7.8L12.4 3.6M12.4 3.6h-2.6M12.4 3.6v2.6" />
    </svg>
  );
}
