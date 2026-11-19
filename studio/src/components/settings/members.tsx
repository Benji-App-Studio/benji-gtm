"use client";
// Settings → Members: who can sign in. The owner adds a person by email (when the server answers with
// an invite link, it is shown to copy and send) and removes members. The owner can't be removed.
import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { InstallMember } from "@/lib/install/types";
import { ask } from "../dialog";
import { IconCheck, IconCopy } from "../icons";
import { Badge, Button, ErrorNote, inputClass, SettingsGroup, SettingsRow, Spinner } from "../ui";
import { api, type ApiResult, ReadOnlyNote, SettingsPage, SettingsRowsSkeleton, Status, WithInstall } from "./settings-ui";

const MEMBERS_URL = "/api/install/members";
type AddAnswer = { member: InstallMember; inviteLink?: string | null; link?: string | null };

export function MembersSettings() {
  return (
    <SettingsPage page="members">
      <WithInstall>
        {(install, manage) => (manage ? <MembersList /> : <ReadOnlyNote install={install} what="who is a member" />)}
      </WithInstall>
    </SettingsPage>
  );
}

function MembersList() {
  const [members, setMembers] = useState<InstallMember[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ error?: string; ok?: string }>({});
  const [invite, setInvite] = useState<{ email: string; link: string; again: boolean } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const show = useCallback((result: ApiResult<{ members: InstallMember[] }>) => {
    if (result.ok && Array.isArray(result.data.members)) { setMembers(result.data.members); setLoadError(null); }
    else setLoadError(result.ok ? "The members didn't load. Try again." : result.error);
  }, []);
  const load = useCallback(async () => show(await api<{ members: InstallMember[] }>(MEMBERS_URL)), [show]);
  useEffect(() => {
    let live = true;
    api<{ members: InstallMember[] }>(MEMBERS_URL).then((result) => { if (live) show(result); });
    return () => { live = false; };
  }, [show]);

  async function add(event: FormEvent) {
    event.preventDefault();
    const address = email.trim();
    if (!/^\S+@\S+\.\S+$/.test(address)) return setNote({ error: "Enter the person's email address." });
    // Someone already on the list: the server answers as if they had just been added. The owner needs
    // nothing; a member is sent on, because adding them again is how a fresh link is made.
    const already = members?.find((member) => member.email?.toLowerCase() === address.toLowerCase());
    if (already?.role === "owner") return setNote({ error: `${address} is the owner of this workspace and can already sign in.` });
    setBusy(true); setNote({}); setInvite(null);
    const result = await api<AddAnswer>(MEMBERS_URL, "POST", { email: address });
    setBusy(false);
    if (!result.ok) return setNote({ error: result.error });
    const link = result.data.inviteLink ?? result.data.link ?? null;
    setEmail("");
    if (link) setInvite({ email: address, link, again: Boolean(already) });
    setNote({ ok: link ? "" : already ? `${address} is already a member and has signed in before.` : `${address} can now sign in with the account they already have.` });
    await load();
  }

  async function remove(member: InstallMember) {
    const who = member.email ?? "this member";
    const yes = await ask({ title: `Remove ${who}?`, body: "They are signed out and can no longer open this workspace. What they made stays.", confirm: "Remove member", danger: true });
    if (!yes) return;
    setRemoving(member.userId); setNote({});
    const result = await api<{ ok: boolean }>(`${MEMBERS_URL}/${encodeURIComponent(member.userId)}`, "DELETE");
    setRemoving(null);
    if (!result.ok) return setNote({ error: result.error });
    setNote({ ok: `${who} was removed.` });
    // Their invite link, if it is still on screen, no longer leads anywhere.
    setInvite((shown) => (shown && shown.email.toLowerCase() === member.email?.toLowerCase() ? null : shown));
    await load();
  }

  return (
    <>
      <SettingsGroup title="Add a member" description="A member signs in with their own email and password and works with this workspace's API keys. Their apps, research and creatives are their own: they don't see yours, and you don't see theirs. Only you can change these settings.">
        <div className="px-4 py-3">
          <form onSubmit={add} className="flex flex-wrap items-center gap-2">
            <input type="email" aria-label="Email address" className={`${inputClass} min-w-0 flex-[1_1_220px]`} value={email} placeholder="name@company.com" autoComplete="off" onChange={(event) => { setEmail(event.target.value); setNote({}); }} disabled={busy} />
            <Button type="submit" size="md" disabled={busy || !email.trim()}>{busy && <Spinner className="size-3.5" />}Add member</Button>
          </form>
          {(note.error || note.ok) && <Status error={note.error} ok={note.ok} className="mt-2" />}
          {invite && <InviteLink email={invite.email} link={invite.link} again={invite.again} />}
        </div>
      </SettingsGroup>

      {loadError && !members ? (
        <ErrorNote title="The members didn't load"><p>{loadError}</p><Button variant="secondary" size="sm" className="mt-3" onClick={() => { void load(); }}>Try again</Button></ErrorNote>
      ) : !members ? <SettingsRowsSkeleton groups={1} rows={2} /> : (
        <SettingsGroup title={members.length === 1 ? "1 member" : `${members.length} members`}>
          {members.map((member) => (
            <SettingsRow key={member.userId} label={<span className="flex flex-wrap items-center gap-2 [overflow-wrap:anywhere]">{member.email ?? "No email on file"}{member.role === "owner" && <Badge>Owner</Badge>}</span>}
              description={`Added ${new Date(member.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`}>
              {member.role !== "owner" && (
                <Button variant="danger" size="sm" disabled={removing !== null} onClick={() => { void remove(member); }}>{removing === member.userId && <Spinner className="size-3.5" />}Remove</Button>
              )}
            </SettingsRow>
          ))}
        </SettingsGroup>
      )}
    </>
  );
}

/** The link a new member uses to set a password. Shown once; the owner copies it and sends it themselves. */
function InviteLink({ email, link, again }: { email: string; link: string; again: boolean }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { /* no clipboard access: the field is selected on focus, so it can be copied by hand */ }
  }
  return (
    <div className="mt-3 rounded-inner border border-line bg-canvas p-3">
      <p className="text-sm text-label"><span className="font-medium text-ink">{again ? `Here is a new link for ${email}.` : `${email} was added.`}</span> Send them this link: it opens a page where they choose a password. It is shown only now, works once, and stops working after about an hour (the sign-in link time set in your Supabase project). If it runs out, add them again for a new link.</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input readOnly aria-label="Invite link" value={link} onFocus={(event) => event.currentTarget.select()} className={`${inputClass} min-w-0 flex-[1_1_240px] font-mono text-xs`} />
        <Button type="button" variant="secondary" onClick={() => { void copy(); }}>{copied ? <IconCheck /> : <IconCopy />}{copied ? "Copied" : "Copy link"}</Button>
      </div>
    </div>
  );
}
