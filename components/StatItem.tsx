import { cn } from '@/lib/cn';

const NUMBER_FORMATTER = new Intl.NumberFormat('en-US');

interface StatItemProps {
  label: string;
  value: string | number;
  valueClassName?: string;
}

export function StatItem({ label, value, valueClassName }: StatItemProps) {
  const isZero = value === 0 || value === '0';
  const formatted =
    typeof value === 'number' ? NUMBER_FORMATTER.format(value) : value;
  return (
    <div className="border-border/75 flex items-center justify-between border-t py-1 pr-4 text-[12px] md:pr-0">
      <div className="text-muted-foreground">{label}</div>
      <span
        className={cn('pl-[1ch] text-right tabular-nums', valueClassName)}
        // The mono face the diff itself is set in. This asked for a Berkeley
        // Mono token that is defined nowhere, so the numbers quietly rendered
        // in the inherited sans.
        style={{
          fontFamily: 'var(--diffs-font-family)',
          opacity: isZero ? 0.5 : 1,
        }}
      >
        {formatted}
      </span>
    </div>
  );
}
