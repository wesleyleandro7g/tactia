/** Atmosfera ember + grain para landing e auth. Decorativa — ignore leitores de tela. */
export function AuthAtmosphere() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute -top-[18%] left-[-12%] h-[58%] w-[72%] rounded-full bg-[radial-gradient(ellipse_at_center,rgba(254,114,0,0.16),transparent_68%)] blur-2xl dark:bg-[radial-gradient(ellipse_at_center,rgba(254,114,0,0.22),transparent_68%)]" />
      <div className="absolute right-[-18%] bottom-[-14%] h-[48%] w-[55%] rounded-full bg-[radial-gradient(ellipse_at_center,rgba(254,34,4,0.1),transparent_70%)] blur-2xl dark:bg-[radial-gradient(ellipse_at_center,rgba(254,34,4,0.16),transparent_70%)]" />
      <div className="absolute inset-0 bg-grain opacity-[0.045] mix-blend-overlay dark:opacity-[0.07]" />
    </div>
  );
}
