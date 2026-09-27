'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { BookOpen, Link2, Plus, Trash2 } from 'lucide-react';
import { opsJson } from '@/lib/ops-fetch';

type Binding = { id: string; resourceType: string; resourceId: string };
type Warning = { code: string; slug: string; message: string };
type Skill = { id: string; kind: 'global' | 'secondary'; slug: string; title: string; description: string; markdown: string; enabled: boolean; bindings: Binding[]; warnings: Warning[] };
type ResourceGroup = { type: string; label: string; items: Array<{ id: string; label: string; detail?: string }> };
type LegacyProfile = { id: string; name: string; skillMarkdown: string; migrated: boolean };

const GLOBAL_TEMPLATE = `# Sobre a empresa
Descreva o setor, operação e contexto da empresa.

## Sistemas e skills
1. Sistema (\`skill:nome_da_skill\`): explique quando usar.

## Como agir
Explique como escolher sistemas, conexões e skills para cada solicitação.`;
const SECONDARY_TEMPLATE = `# Finalidade
Explique para que este sistema ou processo é utilizado.

## Solicitações atendidas
- Liste perguntas e tarefas que usam esta skill.

## Funcionamento
Descreva dados, telas, estruturas e regras específicas.

## Como agir
Descreva o procedimento e a evidência esperada.

## Restrições
Liste o que não deve ser feito.`;

export function AgentSkillsPanel({ tenantId }: { tenantId: string }) {
  const base = `/api/v1/tenants/${tenantId}/agent-skills`;
  const [skills, setSkills] = useState<Skill[]>([]);
  const [resources, setResources] = useState<ResourceGroup[]>([]);
  const [legacyProfiles, setLegacyProfiles] = useState<LegacyProfile[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [kind, setKind] = useState<'global' | 'secondary'>('secondary');
  const [slug, setSlug] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [markdown, setMarkdown] = useState('');
  const [resourceBySkill, setResourceBySkill] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    const result = await opsJson<{ items: Skill[]; resources: ResourceGroup[]; legacyProfiles: LegacyProfile[] }>(base, { method: 'GET' });
    setSkills(result.items); setResources(result.resources); setLegacyProfiles(result.legacyProfiles);
  }, [base]);
  useEffect(() => {
    let active = true;
    void opsJson<{ items: Skill[]; resources: ResourceGroup[]; legacyProfiles: LegacyProfile[] }>(base, { method: 'GET' })
      .then((result) => {
        if (!active) return;
        setSkills(result.items); setResources(result.resources); setLegacyProfiles(result.legacyProfiles);
      })
      .catch((error: unknown) => { if (active) setMessage(error instanceof Error ? error.message : 'Falha ao carregar skills.'); });
    return () => { active = false; };
  }, [base]);

  const globalExists = skills.some((skill) => skill.kind === 'global' && skill.id !== editingId);
  const resourceOptions = useMemo(() => resources.flatMap((group) => group.items.map((item) => ({ value: `${group.type}|${item.id}`, label: `${group.label} · ${item.label}`, detail: item.detail }))), [resources]);

  function reset(nextKind: 'global' | 'secondary' = 'secondary') {
    setEditingId(null); setKind(nextKind); setSlug(nextKind === 'global' ? 'company_global' : ''); setTitle(nextKind === 'global' ? 'Orientação global da empresa' : ''); setDescription(''); setMarkdown(nextKind === 'global' ? GLOBAL_TEMPLATE : SECONDARY_TEMPLATE);
  }
  function edit(skill: Skill) {
    setEditingId(skill.id); setKind(skill.kind); setSlug(skill.slug); setTitle(skill.title); setDescription(skill.description); setMarkdown(skill.markdown);
  }
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      await opsJson(editingId ? `${base}/${editingId}` : base, { method: editingId ? 'PATCH' : 'POST', body: { ...(editingId ? {} : { kind }), slug, title, description, markdown } });
      await load(); reset(); setMessage('Skill salva.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Não foi possível salvar.'); } finally { setBusy(false); }
  }
  async function toggle(skill: Skill) {
    await opsJson(`${base}/${skill.id}`, { method: 'PATCH', body: { enabled: !skill.enabled } }); await load();
  }
  async function remove(skill: Skill) {
    if (!window.confirm(`Excluir a skill ${skill.slug}?`)) return;
    await opsJson(`${base}/${skill.id}`, { method: 'DELETE' }); await load();
  }
  async function bind(skill: Skill) {
    const selected = resourceBySkill[skill.id] ?? '';
    if (!selected) return;
    const [resourceType, resourceId] = selected.split('|');
    await opsJson(`${base}/${skill.id}/bindings`, { method: 'POST', body: { resourceType, resourceId } });
    await load();
    setResourceBySkill((current) => ({ ...current, [skill.id]: '' }));
  }
  async function unbind(skill: Skill, binding: Binding) {
    await opsJson(`${base}/${skill.id}/bindings/${binding.id}`, { method: 'DELETE' }); await load();
  }

  return <section className="overflow-hidden rounded-2xl border border-border bg-card">
    <div className="flex items-center gap-3 border-b border-border bg-secondary/40 px-5 py-4"><BookOpen className="size-5 text-primary" /><div><h2 className="font-mono text-sm font-semibold uppercase tracking-[0.12em]">Skills da empresa</h2><p className="text-xs text-muted-foreground">Orientação global e conhecimentos específicos carregados sob demanda ou por vínculo.</p></div></div>
    <div className="grid gap-6 p-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(340px,0.85fr)]">
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2"><button type="button" disabled={globalExists} onClick={() => reset('global')} className="rounded-md border border-border px-3 py-2 text-xs font-medium disabled:opacity-40">Nova global</button><button type="button" onClick={() => reset('secondary')} className="rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground"><Plus className="mr-1 inline size-3" />Nova secundária</button></div>
        {skills.map((skill) => <article key={skill.id} className="rounded-xl border border-border bg-background p-4">
          <div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2"><strong>{skill.title}</strong><code className="text-xs text-primary">skill:{skill.slug}</code><span className="text-[10px] uppercase text-muted-foreground">{skill.kind}</span></div><p className="mt-1 text-xs text-muted-foreground">{skill.description || 'Sem descrição.'}</p></div><div className="flex gap-2"><button type="button" onClick={() => edit(skill)} className="text-xs text-primary">Editar</button><button type="button" onClick={() => void toggle(skill)} className="text-xs">{skill.enabled ? 'Desabilitar' : 'Habilitar'}</button><button type="button" onClick={() => void remove(skill)} aria-label={`Excluir ${skill.slug}`}><Trash2 className="size-4 text-destructive" /></button></div></div>
          {skill.warnings.length ? <ul className="mt-3 space-y-1 text-xs text-warning">{skill.warnings.map((warning) => <li key={`${warning.code}-${warning.slug}`}>{warning.message}</li>)}</ul> : null}
          {skill.kind === 'secondary' ? <div className="mt-3 space-y-2 border-t border-border pt-3"><div className="flex gap-2"><select value={resourceBySkill[skill.id] ?? ''} onChange={(event) => setResourceBySkill((current) => ({ ...current, [skill.id]: event.target.value }))} className="min-w-0 flex-1 rounded-md border border-border bg-card px-2 py-1.5 text-xs"><option value="">Vincular recurso…</option>{resourceOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><button type="button" disabled={!resourceBySkill[skill.id]} onClick={() => void bind(skill)} className="rounded-md border border-border px-2 text-xs"><Link2 className="size-3" /></button></div><div className="flex flex-wrap gap-1">{skill.bindings.map((binding) => <button type="button" key={binding.id} onClick={() => void unbind(skill, binding)} className="rounded-full bg-secondary px-2 py-1 text-[10px]">{binding.resourceType}:{binding.resourceId.slice(0, 8)} ×</button>)}</div></div> : null}
        </article>)}
        {!skills.length ? <p className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">Nenhuma skill cadastrada.</p> : null}
        {legacyProfiles.length ? <div className="rounded-xl border border-warning/30 bg-warning/5 p-4"><h3 className="text-sm font-semibold">Migração manual pendente</h3><p className="mt-1 text-xs text-muted-foreground">Copie a orientação legada, crie uma skill secundária e vincule ao perfil. O conteúdo antigo não será convertido automaticamente.</p>{legacyProfiles.map((profile) => <details key={profile.id} className="mt-2 text-xs"><summary>{profile.name} · {profile.migrated ? 'vínculo criado' : 'pendente'}</summary><pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-background p-2">{profile.skillMarkdown}</pre></details>)}</div> : null}
      </div>
      <form onSubmit={(event) => void save(event)} className="space-y-3 rounded-xl border border-border bg-background p-4">
        <h3 className="font-mono text-xs font-semibold uppercase">{editingId ? 'Editar skill' : kind === 'global' ? 'Nova global' : 'Nova secundária'}</h3>
        {!editingId ? <select value={kind} onChange={(event) => reset(event.target.value as 'global' | 'secondary')} className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm"><option value="secondary">Secundária</option><option value="global" disabled={globalExists}>Global</option></select> : null}
        <label className="block text-xs font-medium">Slug<input required pattern="[a-z][a-z0-9_]{2,63}" value={slug} onChange={(event) => setSlug(event.target.value.toLowerCase())} disabled={kind === 'global'} className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 font-mono text-sm" /></label>
        <label className="block text-xs font-medium">Título<input required value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm" /></label>
        <label className="block text-xs font-medium">Descrição para o catálogo<input value={description} maxLength={500} onChange={(event) => setDescription(event.target.value)} className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm" /></label>
        <label className="block text-xs font-medium">Markdown<textarea required value={markdown} maxLength={16000} rows={18} onChange={(event) => setMarkdown(event.target.value)} className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 font-mono text-xs" /></label>
        <p className="text-[11px] text-muted-foreground">{markdown.length}/16000 · referências: <code>skill:slug</code> · não inclua segredos.</p>
        {message ? <p role="status" className="text-xs text-primary">{message}</p> : null}
        <button disabled={busy} className="w-full rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">{busy ? 'Salvando…' : 'Salvar skill'}</button>
      </form>
    </div>
  </section>;
}
