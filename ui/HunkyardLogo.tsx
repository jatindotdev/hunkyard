import { cn } from '@/lib/cn';

// Three lines of a diff: one added, one unchanged, one removed.
//
// The same mark as the favicon in public/brand, so the tab and the page agree
// on what this application is. It carries no plate of its own -- the favicon
// needs one to sit on an unknown tab bar, and everywhere else it sits on the
// app's own chrome, which supplies its own background.
export function HunkyardLogo({
  className,
  // Set where the mark is inside something that already says what it is, so a
  // reader hears the control rather than the mark and the control.
  decorative = false,
}: {
  className?: string;
  decorative?: boolean;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 32"
      className={cn('size-6 shrink-0', className)}
      role={decorative ? 'presentation' : 'img'}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : 'Hunkyard'}
    >
      <rect x="3" y="6" width="15" height="5.5" rx="2.75" fill="#3fb950" />
      <rect
        x="3"
        y="13.25"
        width="26"
        height="5.5"
        rx="2.75"
        fill="currentColor"
        opacity="0.55"
      />
      <rect x="3" y="20.5" width="20" height="5.5" rx="2.75" fill="#f85149" />
    </svg>
  );
}
