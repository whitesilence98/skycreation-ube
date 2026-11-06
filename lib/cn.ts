export type ClassValue =
  | string
  | number
  | null
  | undefined
  | false
  | Record<string, boolean | null | undefined>
  | ClassValue[];

/** Minimal className joiner — avoids a clsx/tailwind-merge dependency. */
export function cn(...inputs: ClassValue[]): string {
  const out: string[] = [];

  const walk = (v: ClassValue) => {
    if (!v && v !== 0) return;
    if (typeof v === 'string' || typeof v === 'number') {
      out.push(String(v));
      return;
    }
    if (Array.isArray(v)) {
      v.forEach(walk);
      return;
    }
    if (typeof v === 'object') {
      for (const [k, on] of Object.entries(v)) if (on) out.push(k);
    }
  };

  inputs.forEach(walk);
  return out.join(' ');
}
