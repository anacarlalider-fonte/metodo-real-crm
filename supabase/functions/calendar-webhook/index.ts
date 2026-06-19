// ============================================================================
//  calendar-webhook  ·  Método Real CRM
//  Recebe um evento do Google Calendar (via Zapier) e cria/atualiza uma SESSÃO,
//  vinculada ao cliente pelo E-MAIL de quem foi convidado (mesmos contatos).
//
//  Fluxo:
//    Google Calendar  →  Zapier ("New Event" / "Event Start")
//                     →  POST  https://<projeto>.functions.supabase.co/calendar-webhook?token=SEGREDO
//                     →  esta função: casa o cliente e grava em mr_sessoes (upsert por gcal_id)
//
//  verify_jwt desligado de propósito (Zapier não manda JWT) — auth = token abaixo.
// ============================================================================
import { createClient } from "jsr:@supabase/supabase-js@2";

const SECRET = Deno.env.get("CALENDAR_WEBHOOK_SECRET") ??
  "0060781fc42fc66a75adfa7eb2ee83b2d6c2e9a01ef37970";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;

function extractEmails(body: any): string[] {
  const out: string[] = [];
  const push = (v: any) => {
    if (!v) return;
    if (Array.isArray(v)) v.forEach(push);
    else if (typeof v === "object") push(v.email ?? v.mail ?? v.displayName ?? v.value);
    else if (typeof v === "string") out.push(...(v.match(EMAIL_RE) ?? []));
  };
  push(body.attendees);
  push(body.attendee_emails);
  push(body.attendees_emails);
  push(body.guests);
  push(body.participants);
  return out;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "use POST" }, 405);
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? req.headers.get("x-calendar-secret");
  if (!token || token !== SECRET) return json({ error: "unauthorized" }, 401);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "corpo inválido (JSON)" }, 400); }

  const titulo = body.title ?? body.summary ?? body.event_title ?? body.titulo ?? "Sessão";
  const inicio = body.start ?? body.start_time ?? body.startTime ?? body.dateTime ?? body.begin ?? null;
  const fim    = body.end ?? body.end_time ?? body.endTime ?? null;
  const local  = body.location ?? body.hangoutLink ?? body.conference ?? body.local ?? body.meet_link ?? null;
  const gcalId = body.id ?? body.event_id ?? body.eventId ?? body.iCalUID ?? null;

  const allEmails = [...new Set(extractEmails(body).map((e) => e.toLowerCase().trim()).filter(Boolean))];

  // dono = participante que é usuário do app
  const { data: usersPage } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const userByEmail = new Map((usersPage?.users ?? []).map((u) => [(u.email ?? "").toLowerCase(), u.id]));
  let ownerId: string | null = null;
  for (const e of allEmails) { if (userByEmail.has(e)) { ownerId = userByEmail.get(e)!; break; } }
  // se ninguém casou como usuário, assume o primeiro (único) usuário da conta
  if (!ownerId && (usersPage?.users?.length ?? 0) === 1) ownerId = usersPage!.users[0].id;
  if (!ownerId) return json({ error: "não foi possível identificar o dono (usuário do app)" }, 422);

  const clientEmails = allEmails.filter((e) => !userByEmail.has(e));

  // casa cliente por contatos[].email
  const { data: companies } = await supabase.from("mr_companies")
    .select("id,nome,contatos").eq("user_id", ownerId);
  let companyId: string | null = null;
  for (const c of (companies ?? [])) {
    const cts = Array.isArray((c as any).contatos) ? (c as any).contatos : [];
    if (cts.some((ct: any) => ct?.email && clientEmails.includes(String(ct.email).toLowerCase().trim()))) {
      companyId = (c as any).id; break;
    }
  }

  const row = {
    user_id: ownerId, company_id: companyId, titulo,
    inicio: inicio || null, fim: fim || null, local: local || null,
    emails: clientEmails, gcal_id: gcalId, origem: "google",
  };

  // upsert por (user_id, gcal_id) quando há id; senão insere
  if (gcalId) {
    const { error } = await supabase.from("mr_sessoes")
      .upsert(row, { onConflict: "user_id,gcal_id" });
    if (error) return json({ error: error.message }, 500);
  } else {
    const { error } = await supabase.from("mr_sessoes").insert(row);
    if (error) return json({ error: error.message }, 500);
  }

  return json({ ok: true, cliente: companyId ? (companies?.find((c:any)=>c.id===companyId) as any)?.nome : null, vinculado: !!companyId });
});
