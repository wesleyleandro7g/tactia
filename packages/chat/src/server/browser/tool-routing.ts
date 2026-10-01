const BROWSER_ACTION =
  /\b(acess(?:ar|e|a|ou|ando)|entr(?:ar|e|a|ou|ando)|abr(?:ir|a|e|iu|indo)|naveg(?:ar|ue|a|ou|ando)|consult(?:ar|e|a|ou|ando)|verifi(?:car|que|ca|cou|cando)|bus(?:car|que|ca|cou|cando)|pesquis(?:ar|e|a|ou|ando))\b/i;
const BROWSER_TARGET =
  /https?:\/\/|\b(sistema|portal|erp|crm|painel|dashboard|perfil)\b/i;

/** Deterministic safety net: browser requests must at least discover authorized profiles. */
export function browserInitialToolChoice(
  question: string,
  availableToolNames: string[],
): { type: 'tool'; toolName: 'list_browser_profiles' } | undefined {
  if (!availableToolNames.includes('list_browser_profiles')) return undefined;
  if (!BROWSER_ACTION.test(question) || !BROWSER_TARGET.test(question)) return undefined;
  return { type: 'tool', toolName: 'list_browser_profiles' };
}
