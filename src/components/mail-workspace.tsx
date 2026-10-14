'use client';
import { useCallback, useEffect, useState } from 'react';
import type { Workspace } from '@/lib/types';
import type { MailDomain, MailWorkspace as MailData, Mailbox } from '@/lib/mail-validation';
import { ActionForm, Field } from './forms';

type Action = (body: Record<string, unknown>) => Promise<boolean>;
const statusLabels = {pending: 'En attente de création', active: 'Active', suspended: 'Suspendue', cancelled: 'Demande annulée'};
const operationLabels = {create: 'Création', suspend: 'Suspension', resume: 'Réactivation', reset_password: 'Changement du mot de passe'};
const space = (mb: number) => mb >= 1024 ? `${(mb / 1024).toLocaleString('fr-TN', {maximumFractionDigits: 1})} Go` : `${mb} Mo`;

function DomainEditor({domain, organizations, automatic, onSave, onCancel}: {
  domain?: MailDomain; organizations: Workspace['organizations']; automatic: boolean; onSave: Action; onCancel: () => void;
}) {
  return <section className="panel"><div className="section-title"><h2>{domain ? 'Configurer le domaine' : 'Ajouter un domaine e-mail'}</h2><button onClick={onCancel}>Fermer</button></div>
    <ActionForm label="Enregistrer le domaine" onSubmit={async form => {
      const name = String(form.get('domain')).trim().toLowerCase();
      const ok = await onSave({type: 'save_domain', id: domain?.id, domain: name, organization_id: form.get('organization_id'),
        provider: form.get('provider'), enabled: form.get('enabled') === 'on',
        max_mailboxes: form.get('max_mailboxes') ? Number(form.get('max_mailboxes')) : null,
        total_quota_mb: Number(form.get('total_quota_mb')), mailbox_quota_mb: Number(form.get('mailbox_quota_mb')),
        imap_host: String(form.get('imap_host')).trim() || 'mail.' + name,
        smtp_host: String(form.get('smtp_host')).trim() || 'mail.' + name, smtp_port: Number(form.get('smtp_port'))});
      if (ok) onCancel();
      return ok;
    }}>
      <div className="form-grid">
        <Field label="Client propriétaire"><select name="organization_id" required defaultValue={domain?.organization_id} disabled={!!domain}>
          {organizations.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}
        </select>{domain ? <input type="hidden" name="organization_id" value={domain.organization_id}/> : null}</Field>
        <Field label="Nom de domaine"><input name="domain" required readOnly={!!domain} maxLength={253} defaultValue={domain?.domain} placeholder="entreprise.tn" autoCapitalize="none" autoCorrect="off"/></Field>
        <Field label="Nombre maximal de boîtes — vide = sans plafond de nombre"><input name="max_mailboxes" type="number" min={1} max={1000000} defaultValue={domain?.max_mailboxes ?? ''}/></Field>
        <Field label="Stockage total alloué au domaine (Mo)"><input name="total_quota_mb" type="number" required min={1} max={100000000} defaultValue={domain?.total_quota_mb ?? 20480}/></Field>
        <Field label="Quota maximal par boîte (Mo)"><input name="mailbox_quota_mb" type="number" required min={1} max={100000000} defaultValue={domain?.mailbox_quota_mb ?? 1024}/></Field>
        <Field label="Traitement des opérations"><select name="provider" defaultValue={domain?.provider ?? 'manual'}>
          <option value="manual">Intervention de l’équipe sur le serveur mail</option>
          <option value="mailcow">Automatique via Mailcow API{automatic ? '' : ' — connecteur à configurer'}</option>
        <option value="postfix">Automatique via Postfix/Dovecot local</option>
        </select></Field>
      </div>
      <details><summary>Paramètres Outlook du fournisseur</summary><div className="form-grid spaced">
        <Field label="Serveur IMAP — vide = mail.votre-domaine"><input name="imap_host" defaultValue={domain?.imap_host} placeholder="mail.entreprise.tn"/></Field>
        <Field label="Serveur SMTP — vide = mail.votre-domaine"><input name="smtp_host" defaultValue={domain?.smtp_host} placeholder="mail.entreprise.tn"/></Field>
        <Field label="Envoi sécurisé"><select name="smtp_port" defaultValue={domain?.smtp_port ?? 587}><option value={587}>587 — STARTTLS</option><option value={465}>465 — SSL/TLS</option></select></Field>
      </div></details>
      <label className="checkbox"><input type="checkbox" name="enabled" defaultChecked={domain?.enabled ?? false}/>Autoriser les demandes : je confirme que le domaine, le DNS et le serveur mail sont configurés.</label>
      <p className="small muted">Ajouter un domaine ici ne l’achète pas et ne configure pas ses DNS. Sans plafond de nombre ne signifie pas stockage ou envoi illimités. Les limites du fournisseur restent applicables.</p>
    </ActionForm>
  </section>;
}

function OutlookSettings({domain, mailbox}: {domain: MailDomain; mailbox: Mailbox}) {
  const address = mailbox.local_part + '@' + domain.domain;
  return <section className="mail-settings" aria-label={'Configuration Outlook pour ' + address}>
    <h3>Configurer {address} dans Outlook</h3>
    {mailbox.status !== 'active' ? <p className="muted">Ces paramètres seront utilisables après activation de la boîte.</p> : null}
    <div className="table-wrap"><table><tbody>
      <tr><th>Adresse / identifiant</th><td><code>{address}</code></td></tr>
      <tr><th>Réception IMAP</th><td>{domain.imap_host} · port 993 · SSL/TLS</td></tr>
      <tr><th>Envoi SMTP</th><td>{domain.smtp_host} · port {domain.smtp_port} · {domain.smtp_port === 465 ? 'SSL/TLS' : 'STARTTLS'}</td></tr>
      <tr><th>Authentification SMTP</th><td>Oui, avec la même adresse et le mot de passe de la boîte.</td></tr>
    </tbody></table></div>
    <p className="small">Outlook classique : Fichier → Ajouter un compte → Options avancées → Configuration manuelle → IMAP. Le mot de passe est celui de la boîte mail, distinct de votre connexion SupportFlow.</p>
  </section>;
}

function MailboxActions({domain, mailbox, admin, automatic, onAction}: {
  domain: MailDomain; mailbox: Mailbox; admin: boolean; automatic: boolean; onAction: Action;
}) {
  const [operation, setOperation] = useState<'suspend' | 'resume' | 'reset_password' | null>(null);
  const [settings, setSettings] = useState(false);
  const busy = mailbox.operation !== null;
  const processing = mailbox.operation_state === 'processing' && Date.now() - new Date(mailbox.operation_started_at!).getTime() < 120000;
  return <>
    {busy ? <p className={mailbox.operation_state === 'failed' ? 'error' : 'quote-note'}>
      {operationLabels[mailbox.operation!]} : {mailbox.operation_state === 'failed' ? 'à vérifier chez le fournisseur ; aucune nouvelle tentative automatique' : mailbox.operation_state === 'processing' ? 'traitement en cours' : 'en attente d’intervention de l’équipe'}.
    </p> : null}
    <div className="actions">
      <button onClick={() => setSettings(!settings)} aria-expanded={settings}>Paramètres Outlook</button>
      {domain.enabled && !busy && ['active', 'suspended'].includes(mailbox.status) ? <>
        <button disabled={domain.provider === 'postfix'} onClick={() => setOperation(mailbox.status === 'active' ? 'suspend' : 'resume')}>{mailbox.status === 'active' ? 'Suspendre' : 'Réactiver'}</button>
        <button onClick={() => setOperation('reset_password')}>Changer le mot de passe</button>
      </> : null}
    </div>
    {settings ? <OutlookSettings domain={domain} mailbox={mailbox}/> : null}
    {operation && !busy ? <div className="mail-settings"><h3>{operationLabels[operation]}</h3>
      <ActionForm label={domain.provider === 'manual' ? 'Envoyer la demande à l’équipe' : 'Confirmer l’opération'} onSubmit={async form => {
        const ok = await onAction({type: 'mailbox_operation', mailbox_id: mailbox.id, operation,
          ...(domain.provider !== 'manual' && operation === 'reset_password' ? {password: form.get('password')} : {})});
        if (ok) setOperation(null);
        return ok;
      }}>
        {domain.provider !== 'manual' && operation === 'reset_password' ? <Field label="Nouveau mot de passe de la boîte"><input name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={128}/></Field> : null}
        <p className="small muted">{operation === 'suspend' ? 'La suspension bloque l’utilisation de cette boîte sans supprimer ses messages.' : domain.provider === 'manual' ? 'L’équipe effectuera cette opération chez le fournisseur, puis confirmera son résultat.' : 'La modification sera transmise au serveur mail.'}</p>
        <button type="button" onClick={() => setOperation(null)}>Annuler</button>
      </ActionForm>
    </div> : null}
    {admin && busy ? <details className="mail-settings"><summary>Confirmer une intervention chez le fournisseur</summary>
      {processing ? <p className="muted">Opération en cours. Actualisez après deux minutes si le fournisseur n’a pas répondu.</p> :
        <ActionForm label="Enregistrer la vérification" onSubmit={form => onAction({type: 'resolve_operation', mailbox_id: mailbox.id,
          completed: form.get('completed') === 'yes', verified: form.get('verified') === 'on', note: form.get('note')})}>
          <Field label="Résultat vérifié sur le serveur"><select name="completed"><option value="yes">Opération réalisée et vérifiée</option><option value="no">Opération non réalisée — annuler la demande</option></select></Field>
          <Field label="Compte rendu, sans mot de passe"><textarea name="note" required minLength={10} maxLength={1000} rows={2}/></Field>
          <label className="checkbox"><input name="verified" type="checkbox" required/>J’ai vérifié l’adresse et son état réel chez le fournisseur. En cas d’annulation, aucun changement demandé n’a été appliqué.</label>
          <p className="small muted">Pour une création annulée, le quota sera libéré. Cette confirmation ne crée pas de boîte sur le serveur.</p>
        </ActionForm>}
    </details> : null}
    {!automatic && domain.provider !== 'manual' ? <p className="small muted">Connecteur automatique indisponible ; contactez votre administrateur.</p> : null}
  </>;
}

export function MailWorkspace({workspace}: {workspace: Workspace}) {
  const [data, setData] = useState<MailData | null>(null);
  const [page, setPage] = useState(0);
  const [editor, setEditor] = useState<MailDomain | 'new' | null>(null);
  const [creating, setCreating] = useState<MailDomain | null>(null);
  const [error, setError] = useState(''), [message, setMessage] = useState('');
  const admin = workspace.actor.role === 'admin';
  const canManage = admin || workspace.actor.role === 'client';
  const load = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch('/api/mail?page=' + page, {cache: 'no-store', signal});
    if (response.status === 401) {window.location.assign('/login'); return;}
    const value = await response.json();
    if (!response.ok) throw new Error(value.error);
    if (!signal?.aborted) setData(value);
  }, [page]);
  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal).catch(error => {if (!controller.signal.aborted) setError(error.message);});
    return () => controller.abort();
  }, [load]);
  const action: Action = async body => {
    setError(''); setMessage('');
    try {
      const response = await fetch('/api/mail', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setMessage(result.message);
      await load();
      return true;
    } catch (error) {setError(error instanceof Error ? error.message : 'Messagerie indisponible.'); return false;}
  };
  return <div>
    {error ? <p className="error" role="alert">{error}</p> : null}
    {message ? <p className="success" role="status">{message}</p> : null}
    <section className="panel"><div className="section-title"><div><h2>Vos domaines & boîtes mail</h2><p className="muted">Créez des adresses professionnelles et retrouvez leurs paramètres Outlook.</p></div>
      <div className="actions"><button onClick={() => load().catch(error => setError(error.message))}>Actualiser</button>
      {admin ? <button className="primary" disabled={!workspace.organizations.length} onClick={() => setEditor('new')}>Ajouter un domaine</button> : null}</div>
    </div>
      <p className="small muted">Le domaine est saisi et attribué au client par l’admin. Les opérations en attente ne sont pas encore appliquées au serveur mail.</p>
      {admin && !workspace.organizations.length ? <p>Ajoutez d’abord un client dans « Clients & applications ».</p> : null}
    </section>
    {!data && !error ? <p role="status">Chargement de la messagerie…</p> : null}
    {editor && data ? <DomainEditor key={editor === 'new' ? 'new' : editor.id} domain={editor === 'new' ? undefined : editor}
      organizations={workspace.organizations} automatic={data.automatic_available} onSave={action} onCancel={() => setEditor(null)}/> : null}
    {data?.domains.map(domain => <section className="panel" key={domain.id}>
      <div className="section-title"><div><h2>{domain.domain}</h2><span className="small muted">{workspace.organizations.find(org => org.id === domain.organization_id)?.name}</span></div>
        <div className="actions"><span className="badge">{domain.enabled ? 'Demandes autorisées' : 'À configurer'}</span>{admin ? <button onClick={() => setEditor(domain)}>Configurer</button> : null}</div>
      </div>
      <div className="mail-metrics"><p><strong>{domain.mailbox_count}</strong> boîtes / {domain.max_mailboxes ?? 'sans plafond de nombre'}</p>
        <p><strong>{space(domain.allocated_quota_mb)}</strong> réservés / {space(domain.total_quota_mb)}</p>
        <p>Maximum par boîte : <strong>{space(domain.mailbox_quota_mb)}</strong></p></div>
      <p className="small muted">{domain.provider === 'manual' ? 'Les demandes sont traitées par l’équipe.' : data.automatic_available ? 'Création et gestion automatiques via le serveur mail.' : 'Le connecteur du serveur mail doit être configuré.'} Le stockage affiché correspond aux quotas réservés, pas au volume réel des messages. {domain.provider === 'postfix' ? 'Ce connecteur ne limite pas physiquement le stockage. Suspension automatique indisponible.' : ''}</p>
      {canManage ? <button disabled={!domain.enabled || (domain.provider !== 'manual' && !data.automatic_available)} onClick={() => setCreating(domain)}>{domain.provider === 'manual' ? 'Demander une boîte mail' : 'Créer une boîte mail'}</button> : null}
    </section>)}
    {data && !data.domains.length ? <section className="panel empty"><h3>Aucun domaine associé</h3><p>{admin ? 'Ajoutez le domaine de votre choix et associez-le à un client.' : 'Votre administrateur doit vous attribuer un domaine pour activer ce service.'}</p></section> : null}
    {creating ? <section className="panel"><div className="section-title"><h2>Nouvelle adresse @{creating.domain}</h2><button onClick={() => setCreating(null)}>Fermer</button></div>
      <ActionForm label={creating.provider === 'manual' ? 'Envoyer la demande de création' : 'Créer la boîte sur le serveur'} onSubmit={async form => {
        const ok = await action({type: 'create_mailbox', domain_id: creating.id, local_part: form.get('local_part'),
          display_name: form.get('display_name'), quota_mb: Number(form.get('quota_mb')),
          ...(creating.provider !== 'manual' ? {password: form.get('password')} : {})});
        if (ok) setCreating(null);
        return ok;
      }}>
        <div className="form-grid"><Field label={'Adresse avant @' + creating.domain}><input name="local_part" required maxLength={64} pattern="[a-zA-Z0-9]+(([.]|_|-)[a-zA-Z0-9]+)*" placeholder="contact" autoCapitalize="none" autoCorrect="off"/></Field>
          <Field label="Nom affiché"><input name="display_name" required maxLength={120} placeholder="Équipe contact"/></Field>
          <Field label="Quota réservé (Mo)"><input name="quota_mb" type="number" required min={1} max={creating.mailbox_quota_mb} defaultValue={creating.mailbox_quota_mb}/></Field>
          {creating.provider !== 'manual' ? <Field label="Mot de passe de la boîte"><input name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={128}/></Field> : null}
        </div><p className="small muted">{creating.provider === 'manual' ? 'L’équipe configurera la boîte et vous indiquera comment définir son mot de passe.' : 'Le mot de passe est transmis au serveur mail et n’est pas conservé dans SupportFlow.'}</p>
      </ActionForm>
    </section> : null}
    {data ? <section className="panel"><div className="section-title"><h2>Boîtes mail ({data.total_mailboxes})</h2><span className="small muted">Page {page + 1}</span></div>
      {data.mailboxes.map(mailbox => {
        const domain = data.domains.find(domain => domain.id === mailbox.domain_id);
        if (!domain) return null;
        return <article className="mailbox-card" key={mailbox.id}><div className="section-title"><div><strong className="mail-address">{mailbox.local_part}@{domain.domain}</strong><p className="small muted">{mailbox.display_name} · quota {space(mailbox.quota_mb)}</p></div><span className="badge">{statusLabels[mailbox.status]}</span></div>
          {canManage ? <MailboxActions domain={domain} mailbox={mailbox} admin={admin} automatic={data.automatic_available} onAction={action}/> : <OutlookSettings domain={domain} mailbox={mailbox}/>}
        </article>;
      })}
      {!data.mailboxes.length ? <p className="empty">Aucune boîte à afficher.</p> : null}
      <div className="actions spaced"><button disabled={page === 0} onClick={() => setPage(page - 1)}>Précédent</button><button disabled={(page + 1) * 50 >= data.total_mailboxes} onClick={() => setPage(page + 1)}>Suivant</button></div>
    </section> : null}
  </div>;
}

