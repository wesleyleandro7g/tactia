/** Deterministically research questions that explicitly depend on public external context. */
export function publicWebInitialToolChoice(
  question: string,
  availableToolNames: string[],
): { type: 'tool'; toolName: 'search_public_web' } | undefined {
  if (!availableToolNames.includes('search_public_web')) return undefined;
  if (!/https?:\/\/\S+|\b(mercado|setor|concorr[eê]n(?:te|cia|tes)|not[ií]cias?|regulamenta[cç][aã]o|economia|infla[cç][aã]o)\b/i.test(question)) return undefined;
  return { type: 'tool', toolName: 'search_public_web' };
}

/** A public URL should be researched without requiring an authenticated browser profile. */
export function isPublicPageRequest(question: string): boolean {
  return /https?:\/\/\S+/i.test(question)
    && !/\b(sistema|portal|erp|crm|painel|dashboard|perfil)\b/i.test(question);
}
