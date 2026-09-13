import Link from 'next/link';
import { AuthAtmosphere } from '@/components/app/auth-atmosphere';
import { BrandLogo } from '@/components/app/brand-logo';
import { ThemeToggle } from '@/components/app/theme-toggle';
import { Button } from '@/components/ui/button';

export default function HomePage() {
  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden bg-background">
      <AuthAtmosphere />
      <div className="absolute top-4 right-4 z-20 sm:top-6 sm:right-6">
        <ThemeToggle />
      </div>
      <div className="relative z-10 mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center px-6 py-20 sm:px-10">
        <div className="max-w-xl animate-page-enter">
          <BrandLogo className="h-10" priority />
          <h1 className="mt-10 font-display text-5xl leading-[1.05] tracking-tight text-foreground sm:text-6xl">
            Entenda. Decida. <span className="text-brand">Execute.</span>
          </h1>
          <p className="mt-6 max-w-md text-base leading-relaxed text-muted-foreground sm:text-lg">
            Camada de inteligência operacional para a sua empresa.
          </p>
          <div className="mt-10 flex flex-wrap gap-3">
            <Link href="/login">
              <Button size="md">Entrar</Button>
            </Link>
            <Link href="/signup">
              <Button variant="outline" size="md">
                Criar empresa
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
