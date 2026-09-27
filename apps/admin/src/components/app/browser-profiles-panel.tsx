'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Globe2, Key, Plus } from 'lucide-react';
import { opsJson } from '@/lib/ops-fetch';

type Profile = { id: string; name: string; startUrl: string; allowedDomains: string[]; skillMarkdown: string; credentialId: string | null };



export function BrowserProfilesPanel({ tenantId }: { tenantId: string }) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [name, setName] = useState('');
  const [startUrl, setStartUrl] = useState('');
  const [domains, setDomains] = useState('');
  const [skills, setSkills] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const base = `/api/v1/tenants/${tenantId}`;

  function edit(profile: Profile) {
    setEditingId(profile.id);
    setName(profile.name);
    setStartUrl(profile.startUrl);
    setDomains(profile.allowedDomains.join(', '));
    setSkills(profile.skillMarkdown);
    setUsername('');
    setPassword('');
    setError('');
    setNotice('');
  }

  function resetForm() {
    setEditingId(null);
    setName(''); setStartUrl(''); setDomains(''); setSkills(''); setUsername(''); setPassword('');
  }

  useEffect(() => {
    let active = true;
    void opsJson<{ items: Profile[]; globalSkillMarkdown: string }>(`${base}/browser-profiles`, { method: 'GET' })
      .then((result) => { if (active) setProfiles(result.items); })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Falha ao carregar perfis.'); });
    return () => { active = false; };
  }, [base]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      let credentialId: string | undefined;
      if (username || password) {
        if (!username || !password) throw new Error('Informe usuário e senha juntos.');
        const credential = await opsJson<{ id: string }>(`${base}/credentials`, {
          body: { provider: 'browser', data: { username, password } },
        });
        credentialId = credential.id;
      }
      const profile = await opsJson<Profile>(editingId ? `${base}/browser-profiles/${editingId}` : `${base}/browser-profiles`, {
        method: editingId ? 'PATCH' : 'POST',
        body: {
          name, startUrl,
          allowedDomains: domains.split(/[\s,]+/).map((value) => value.trim().toLowerCase()).filter(Boolean),
          ...(credentialId ? { credentialId } : {}),
        },
      });
      setProfiles((current) => [...current.filter((item) => item.id !== profile.id), profile].sort((a, b) => a.name.localeCompare(b.name)));
      resetForm();
      setNotice(editingId ? 'Perfil atualizado.' : 'Perfil disponível para tarefas no chat.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível salvar o perfil.');
    } finally {
      setBusy(false);
    }
  }


  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex items-center gap-3 border-b border-border bg-secondary/40 px-5 py-4">
        <span className="flex size-9 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary"><Globe2 size={18} /></span>
        <div>
          <h2 className="font-mono text-sm font-semibold uppercase tracking-[0.12em]">Navegador · perfis</h2>
          <p className="text-xs text-muted-foreground">Sites e credenciais liberados para o Browser Agent desta empresa.</p>
        </div>
      </div>
      <div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(300px,0.9fr)]">
        <div>
          <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.15em] text-muted-foreground">Perfis ativos · {profiles.length}</p>
          {profiles.length ? <ul className="space-y-2">{profiles.map((profile) => (
            <li key={profile.id} className="rounded-xl border border-border/80 bg-background px-4 py-3">
              <div className="flex items-center justify-between gap-3"><strong className="text-sm">{profile.name}</strong><div className="flex items-center gap-3">{profile.credentialId ? <span className="flex items-center gap-1 text-[11px] text-primary"><Key size={12} /> Cofre</span> : null}<button type="button" onClick={() => edit(profile)} className="text-xs font-medium text-primary hover:underline">Editar</button></div></div>
              <p className="mt-1 truncate font-mono text-xs text-muted-foreground">{profile.startUrl}</p>
              <p className="mt-2 text-[11px] text-muted-foreground">{profile.allowedDomains.join(' · ')}</p>
              <p className="mt-2 text-[11px] text-muted-foreground">{profile.skillMarkdown ? 'Skill Markdown configurada' : 'Sem skill específica'}</p>
            </li>
          ))}</ul> : <p className="rounded-xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">Nenhum site configurado.</p>}
        </div>
        <form onSubmit={(event) => void create(event)} className="space-y-3 rounded-xl border border-border bg-background p-4">
          <div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2"><Plus size={15} className="text-primary" /><h3 className="font-mono text-xs font-semibold uppercase tracking-[0.13em]">{editingId ? 'Editar perfil' : 'Novo perfil'}</h3></div>{editingId ? <button type="button" onClick={resetForm} className="text-xs text-muted-foreground hover:text-foreground">Cancelar</button> : null}</div>
          <label className="block text-xs font-medium">Nome<input required value={name} onChange={(event) => setName(event.target.value)} placeholder="ERP financeiro" className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm" /></label>
          <label className="block text-xs font-medium">URL inicial<input required type="url" value={startUrl} onChange={(event) => setStartUrl(event.target.value)} placeholder="https://erp.empresa.com" className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm" /></label>
          <label className="block text-xs font-medium">Destinos permitidos<input required value={domains} onChange={(event) => setDomains(event.target.value)} placeholder="erp.empresa.com, api.empresa.com:8443" className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm" /><span className="mt-1 block font-normal text-muted-foreground">Separe por vírgula; portas alternativas devem ser autorizadas explicitamente.</span></label>
          {editingId && skills ? <label className="block text-xs font-medium">Orientação legada do perfil<textarea readOnly value={skills} rows={8} className="mt-1 w-full rounded-md border border-warning/30 bg-muted px-3 py-2 font-mono text-xs" /><span className="mt-1 block font-normal text-muted-foreground">Somente leitura. Copie o conteúdo para uma skill secundária no catálogo acima e vincule-a a este perfil.</span></label> : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-medium">Usuário<input autoComplete="off" value={username} onChange={(event) => setUsername(event.target.value)} className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm" /></label>
            <label className="block text-xs font-medium">Senha<input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm" /></label>
          </div>
          {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
          {notice ? <p role="status" className="text-xs text-primary">{notice}</p> : null}
          <button disabled={busy} className="w-full rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">{busy ? 'Salvando…' : editingId ? 'Salvar alterações' : 'Adicionar perfil'}</button>
        </form>
      </div>
    </section>
  );
}
