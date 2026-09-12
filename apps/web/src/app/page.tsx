import Link from 'next/link';
import { ThemeToggle } from '@/components/app/theme-toggle';
import { Button } from '@/components/ui/button';

export default function HomePage() {
  return (
    <main className="relative mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-8 px-6 py-16">
      <div className="absolute top-4 right-4 sm:top-6 sm:right-6">
        <ThemeToggle />
      </div>
      <div>
        <p className="text-sm font-medium tracking-wide text-muted-foreground">TACTIA</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-foreground">
          Entenda. Decida. Execute.
        </h1>
        <p className="mt-4 max-w-lg text-base leading-relaxed text-muted-foreground">
          Camada de inteligência operacional para a sua empresa.
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <Link href="/login">
          <Button>Entrar</Button>
        </Link>
        <Link href="/signup">
          <Button variant="outline">Criar empresa</Button>
        </Link>
      </div>
    </main>
  );
}
