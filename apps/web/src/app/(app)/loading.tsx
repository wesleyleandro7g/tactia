import { Skeleton, SkeletonCard } from '@/components/ui/feedback';

export default function AppLoading() {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6" aria-busy="true">
      <div>
        <Skeleton className="h-8 w-48" />
        <Skeleton className="mt-3 h-4 w-full max-w-xl" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <SkeletonCard lines={3} />
        <SkeletonCard lines={3} />
      </div>
      <span className="sr-only">Carregando a central de comando…</span>
    </div>
  );
}
