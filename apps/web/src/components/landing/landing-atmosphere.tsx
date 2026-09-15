/** Atmosfera cinematográfica da landing. Decorativa — ignore leitores de tela. */
export function LandingAtmosphere() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <div className="absolute inset-0 bg-background" />
      <div className="absolute -top-[18%] left-[-12%] h-[55%] w-[58%] rounded-full bg-[radial-gradient(ellipse_at_center,rgba(254,114,0,0.14),transparent_70%)] blur-3xl dark:bg-[radial-gradient(ellipse_at_center,rgba(254,114,0,0.22),transparent_70%)]" />
      <div className="absolute top-[12%] right-[-8%] h-[48%] w-[42%] rounded-full bg-[radial-gradient(ellipse_at_center,rgba(254,114,0,0.16),transparent_68%)] blur-3xl dark:bg-[radial-gradient(ellipse_at_center,rgba(254,114,0,0.28),transparent_68%)]" />
      <div className="absolute bottom-[-10%] left-[10%] h-[38%] w-[70%] rounded-full bg-[radial-gradient(ellipse_at_center,rgba(254,114,0,0.12),transparent_72%)] blur-3xl dark:bg-[radial-gradient(ellipse_at_center,rgba(254,114,0,0.2),transparent_72%)]" />

      <div className="absolute top-0 right-0 h-[min(28vw,280px)] w-[min(32vw,340px)] bg-brand opacity-55 [clip-path:polygon(28%_0,100%_0,100%_100%)] dark:opacity-70" />
      <div className="absolute top-0 right-0 h-[min(16vw,160px)] w-[min(22vw,220px)] bg-[#fe2204] opacity-45 [clip-path:polygon(52%_0,100%_0,100%_78%)]" />

      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_40%,rgba(19,18,18,0.35)_100%)] dark:bg-[radial-gradient(ellipse_at_center,transparent_32%,rgba(8,7,7,0.7)_100%)]" />
      <div className="absolute inset-0 bg-grain opacity-[0.04] mix-blend-overlay dark:opacity-[0.08]" />
    </div>
  );
}
