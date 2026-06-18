// ============================================================================
//  tactiq-webhook  ·  Método Real CRM
//  Recebe uma reunião transcrita pelo Tactiq (via Zapier) e anexa a ata ao
//  cliente correspondente — identificado pelo E-MAIL de quem participou da call.
//
//  Fluxo:
//    Tactiq  →  Zapier (gatilho "Meeting Transcript Is Ready")
//            →  POST  https://<projeto>.functions.supabase.co/tactiq-webhook?token=SEGREDO
//            →  esta função:
//                 1. descobre o consultor (dono) = participante que é usuário do app
//                 2. casa os demais e-mails com contatos[].email das empresas do dono
//                 3. 1 empresa  → grava a ata em mr_companies.atas
//                    0 ou várias → grava em mr_tactiq_inbox (atribuição manual no app)
//
//  Segurança: token secreto em ?token= (ou header x-tactiq-secret).
//  verify_jwt está desligado de propósito — o Zapier não manda JWT do Supabase;
//  a autenticação é o token abaixo.
// ============================================================================
import { createClient } from "jsr:@supabase/supabase-js@2";

// Token que protege o webhook. Pode sobrescrever criando o secret
// TACTIQ_WEBHOOK_SECRET nas Edge Functions; senão usa este valor.
const SECRET = Deno.env.get("TACTIQ_WEBHOOK_SECRET") ??
  "d62fc71384da0e1aa76bdf107fce16b45612eb1370c1be7a";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;

// Junta e-mails de qualquer formato que o Zapier mande (array, objeto, string).
function extractEmails(body: any): string[] {
  const out: string[] = [];
  const push = (v: any) => {
    if (!v) return;
    if (Array.isArray(v)) v.forEach(push);
    else if (typeof v === "object") push(v.email ?? v.mail ?? v.address ?? v.value);
    else if (typeof v === "string") out.push(...(v.match(EMAIL_RE) ?? []));
  };
  push(body.attendees);
  push(body.participants);
  push(body.emails);
  push(body.attendee_emails);
  push(body.participant_emails);
  push(body.meeting_attendees);
  return out;
}

function asText(v: any): string {
  if (!v) return "";
  if (Array.isArray(v)) {
    return v.map((x) =>
      typeof x === "object" ? (x.text ?? x.title ?? x.value ?? JSON.stringify(x)) : String(x)
    ).join("\n");
  }
  return String(v);
}

function composeTexto(t: { transcript: string; resumo: string; acoes: string }): string {
  const parts: string[] = [];
  if (t.resumo) parts.push("📋 Resumo (Tactiq):\n" + t.resumo);
  if (t.acoes) parts.push("✅ Próximos passos:\n" + t.acoes);
  if (t.transcript) parts.push("🎙 Transcrição:\n" + t.transcript);
  return parts.join("\n\n———\n\n");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "use POST" }, 405);

  // --- auth por token secreto ---
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? req.headers.get("x-tactiq-secret");
  if (!token || token !== SECRET) return json({ error: "unauthorized" }, 401);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "corpo inválido (esperado JSON)" }, 400);
  }

  const titulo = body.title ?? body.meeting_title ?? body.titulo ?? "Reunião";
  const data = String(body.date ?? body.meeting_date ?? body.created_at ?? "").slice(0, 10) ||
    new Date().toISOString().slice(0, 10);
  const transcript = body.transcript ?? body.transcript_text ?? body.text ?? body.full_transcript ?? "";
  const resumo = body.summary ?? body.ai_summary ?? body.meeting_summary ?? body.resumo ?? "";
  const acoes = asText(body.action_items ?? body.actions ?? body.action_points ?? body.acoes ?? "");

  const allEmails = [...new Set(extractEmails(body).map((e) => e.toLowerCase().trim()).filter(Boolean))];
  if (!allEmails.length) {
    return json({ error: "nenhum e-mail de participante encontrado no payload" }, 422);
  }

  // 1. dono = participante que é usuário cadastrado no app (o consultor está sempre na call)
  const { data: usersPage } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const userByEmail = new Map(
    (usersPage?.users ?? []).map((u) => [(u.email ?? "").toLowerCase(), u.id]),
  );
  let ownerId: string | null = null;
  for (const e of allEmails) {
    if (userByEmail.has(e)) { ownerId = userByEmail.get(e)!; break; }
  }

  // e-mails "de cliente" = participantes que NÃO são usuários do app
  const clientEmails = allEmails.filter((e) => !userByEmail.has(e));

  // 2. casar com contatos[].email das empresas (do dono, se conhecido)
  let q = supabase.from("mr_companies").select("id,nome,contatos,atas,user_id");
  if (ownerId) q = q.eq("user_id", ownerId);
  const { data: companies, error } = await q;
  if (error) return json({ error: error.message }, 500);

  const matches = (companies ?? []).filter((c: any) =>
    Array.isArray(c.contatos) &&
    c.contatos.some((ct: any) =>
      ct?.email && clientEmails.includes(String(ct.email).toLowerCase().trim())
    )
  );

  const ata = {
    data,
    titulo,
    texto: composeTexto({ transcript, resumo, acoes }),
    resumo,
    acoes,
    emails: clientEmails,
    fonte: "tactiq",
    criado: new Date().toISOString(),
  };

  // 1 empresa → grava a ata direto na ficha
  if (matches.length === 1) {
    const c: any = matches[0];
    const atas = Array.isArray(c.atas) ? c.atas : [];
    atas.unshift(ata);
    const { error: upErr } = await supabase.from("mr_companies").update({ atas }).eq("id", c.id);
    if (upErr) return json({ error: upErr.message }, 500);
    return json({ ok: true, vinculado: c.nome, company_id: c.id });
  }

  // 0 ou várias → caixa de entrada para atribuição manual
  const { error: inErr } = await supabase.from("mr_tactiq_inbox").insert({
    user_id: ownerId,
    titulo,
    data,
    emails: clientEmails,
    resumo,
    acoes,
    texto: transcript,
    motivo: matches.length > 1 ? "multiplos_matches" : "sem_match",
    candidatos: matches.map((m: any) => ({ id: m.id, nome: m.nome })),
  });
  if (inErr) return json({ error: inErr.message }, 500);

  return json({
    ok: true,
    inbox: true,
    motivo: matches.length > 1 ? "multiplos_matches" : "sem_match",
    candidatos: matches.length,
  });
});
