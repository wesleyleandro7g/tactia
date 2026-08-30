import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-6 px-6">
      <div>
        <p className="text-sm tracking-wide text-[var(--muted)]">TACTIA</p>
        <h1 className="mt-2 text-4xl font-semibold">Entenda. Decida. Execute.</h1>
        <p className="mt-3 text-[var(--muted)]">
          Camada de inteligência operacional para a sua empresa.
        </p>
      </div>
      <div className="flex gap-3">
        <Link
          href="/login"
          className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white"
        >
          Entrar
        </Link>
        <Link
          href="/signup"
          className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium"
        >
          Criar empresa
        </Link>
      </div>
    </main>
  );
}
