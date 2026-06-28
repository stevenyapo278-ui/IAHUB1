import { cn } from '../lib/utils';

const variants = {
  text: 'h-4 w-full rounded',
  'text-sm': 'h-3 w-3/4 rounded',
  'text-lg': 'h-6 w-2/3 rounded-lg',
  title: 'h-8 w-1/2 rounded-xl',
  avatar: 'h-10 w-10 rounded-full',
  'avatar-sm': 'h-8 w-8 rounded-full',
  'avatar-lg': 'h-14 w-14 rounded-full',
  card: 'h-32 w-full rounded-2xl',
  'card-sm': 'h-24 w-full rounded-2xl',
  'table-row': 'h-14 w-full rounded-xl',
  'table-cell': 'h-4 w-full rounded',
  chart: 'h-[300px] w-full rounded-2xl',
  badge: 'h-6 w-16 rounded-full',
  button: 'h-10 w-28 rounded-xl',
};

export default function Skeleton({ variant = 'text', className, count = 1 }) {
  const baseClasses = 'animate-pulse bg-surface-container-high/60 dark:bg-surface-container-high/40';
  const variantClass = variants[variant] || variants.text;

  const items = Array.from({ length: count }, (_, i) => (
    <div
      key={i}
      className={cn(baseClasses, variantClass, className)}
      aria-hidden="true"
    />
  ));

  if (count === 1) return items[0];
  return <div className="flex flex-col gap-3">{items}</div>;
}

export function TableSkeleton({ rows = 5, columns = 6 }) {
  return (
    <div className="flex flex-col gap-2">
      {/* Header */}
      <div className="flex gap-4 px-md py-3">
        {Array.from({ length: columns }, (_, i) => (
          <Skeleton key={i} variant="table-cell" className="h-3" />
        ))}
      </div>
      {/* Rows */}
      {Array.from({ length: rows }, (_, rowIdx) => (
        <div key={rowIdx} className="flex gap-4 px-md py-3 border-t border-outline-variant/30">
          {Array.from({ length: columns }, (_, colIdx) => (
            <Skeleton key={colIdx} variant="table-cell" className="h-4" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function StatCardSkeleton() {
  return (
    <div className="bg-surface-container-lowest border border-outline-variant/60 rounded-2xl p-lg flex flex-col gap-md">
      <div className="flex justify-between items-start">
        <Skeleton variant="badge" />
        <Skeleton variant="avatar-sm" />
      </div>
      <Skeleton variant="title" className="h-10 w-20" />
      <Skeleton variant="text-sm" className="w-2/3" />
    </div>
  );
}
