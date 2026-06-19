// ============================================================================
//  calendar-webhook  ·  Método Real CRM
//  Recebe um evento do Google Calendar (via Zapier) e cria/atualiza uma SESSÃO.
//  A agenda da Ana é mista (pessoal + trabalho) e as sessões são marcadas com o
//  NOME DO CLIENTE NO TÍTULO (ex.: "VIVEZA - PRESENCIAL"), sem convidar e-mail.
//  Por isso o match é: (1) e-mail do convidado nos contatos, OU (2) nome do
//  cliente no título. Eventos que não casam com nenhum cliente são IGNORADOS
//  (não polui a agenda do CRM com ALMOÇO, ACADEMIA, etc.).
//
//  verify_jwt desligado (Zapier não manda JWT) — auth = token.
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
  push(body.attendees); push(body.attendee_emails); push(body.guests); push(body.participants);
  return out;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "use POST" }, 405);
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? req.headers.get("x-calendar-secret");
  if (!token || token !== SECRET) return json({ error: "unauthorized" }, 401);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "corpo inválido (JSON)" }, 400); }

  const titulo = String(body.title ?? body.summary ?? body.event_title ?? body.titulo ?? "Sessão");
  const inicio = body.start ?? body.start_time ?? body.startTime ?? body.dateTime ?? body.begin ?? null;
  const fim    = body.end ?? body.end_time ?? body.endTime ?? null;
  const local  = body.location ?? body.hangoutLink ?? body.conference ?? body.local ?? body.meet_link ?? null;
  const gcalId = body.id ?? body.event_id ?? body.eventId ?? body.iCalUID ?? null;

  const allEmails = [...new Set(extractEmails(body).map((e) => e.toLowerCase().trim()).filter(Boolean))];

  const { data: usersPage } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const userByEmail = new Map((usersPage?.users ?? []).map((u) => [(u.email ?? "").toLowerCase(), u.id]));
  let ownerId: string | null = null;
  for (const e of allEmails) { if (userByEmail.has(e)) { ownerId = userByEmail.get(e)!; break; } }
  if (!ownerId && (usersPage?.users?.length ?? 0) === 1) ownerId = usersPage!.users[0].id;
  if (!ownerId) return json({ error: "não foi possível identificar o dono" }, 422);

  const clientEmails = allEmails.filter((e) => !userByEmail.has(e));
  const { data: companies } = await supabase.from("mr_companies").select("id,nome,contatos").eq("user_id", ownerId);

  const titleLow = titulo.toLowerCase();
  let companyId: string | null = null, matchedNome: string | null = null;
  // 1) por e-mail do convidado (contatos)
  for (const c of (companies ?? [])) {
    const cts = Array.isArray((c as any).contatos) ? (c as any).contatos : [];
    if (cts.some((ct: any) => ct?.email && clientEmails.includes(String(ct.email).toLowerCase().trim()))) {
      companyId = (c as any).id; matchedNome = (c as any).nome; break;
    }
  }
  // 2) por nome do cliente no título
  if (!companyId) {
    for (const c of (companies ?? [])) {
      const nome = String((c as any).nome || "").toLowerCase().trim();
      if (!nome) continue;
      const first = nome.split(/\s+/)[0];
      if ((nome.length >= 4 && titleLow.includes(nome)) || (first.length >= 4 && titleLow.includes(first))) {
        companyId = (c as any).id; matchedNome = (c as any).nome; break;
      }
    }
  }

  // Sem cliente → ignora (evento pessoal/sem relação com o CRM)
  if (!companyId) return json({ ok: true, skipped: true, reason: "evento sem cliente (ignorado)" });

  const row = {
    user_id: ownerId, company_id: companyId, titulo,
    inicio: inicio || null, fim: fim || null, local: local || null,
    emails: clientEmails, gcal_id: gcalId, origem: "google",
  };
  if (gcalId) {
    const { error } = await supabase.from("mr_sessoes").upsert(row, { onConflict: "user_id,gcal_id" });
    if (error) return json({ error: error.message }, 500);
  } else {
    const { error } = await supabase.from("mr_sessoes").insert(row);
    if (error) return json({ error: error.message }, 500);
  }
  return json({ ok: true, cliente: matchedNome, vinculado: true });
});
