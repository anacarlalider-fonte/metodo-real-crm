// ============================================================================
//  candidatura-submit · Método Real CRM — Recrutamento & Seleção
//  GET  ?vaga=<id>  -> devolve {titulo,status} da vaga (form lê sem segredo).
//  POST multipart   -> valida, sobe currículo e cria o card na 1ª etapa.
//
//  Anti-spam: honeypot ('website') + tempo mínimo ('_ts') + rate-limit por
//  e-mail/telefone (24h). verify_jwt = false (form público).
// ============================================================================
import { createClient } from "jsr:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });

const EXT_OK: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB

const onlyDigits = (s: string) => (s || "").replace(/\D/g, "");
const slug = (s: string) =>
  (s || "cv").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 60);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // ---- GET: dados públicos da vaga (para o formulário por vaga) ----
  if (req.method === "GET") {
    const vagaId = new URL(req.url).searchParams.get("vaga");
    if (!vagaId) return json({ error: "vaga?" }, 400);
    const { data: v } = await supabase.from("mr_vagas")
      .select("id,titulo,status,local,descricao").eq("id", vagaId).maybeSingle();
    if (!v) return json({ error: "Vaga não encontrada." }, 404);
    return json({ vaga: v });
  }

  if (req.method !== "POST") return json({ error: "method" }, 405);

  let form: FormData;
  try { form = await req.formData(); }
  catch { return json({ error: "Envio inválido." }, 400); }

  const get = (k: string) => (form.get(k) ?? "").toString().trim();

  // --- Anti-spam: honeypot (bots preenchem campos ocultos) ---
  if (get("website")) return json({ ok: true }); // finge sucesso, descarta
  // --- Anti-spam: tempo mínimo (bots enviam instantâneo) ---
  const ts = Number(get("_ts"));
  if (ts && (Date.now() - ts) < 2500) return json({ ok: true });

  const nome  = get("nome");
  const email = get("email").toLowerCase();
  const tel   = get("telefone");
  const consent = ["true", "on", "1"].includes(get("consentimento"));
  const verdade = ["true", "on", "1"].includes(get("veracidade"));

  if (!nome)  return json({ error: "Informe seu nome completo." }, 400);
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "E-mail inválido." }, 400);
  if (!tel || onlyDigits(tel).length < 10) return json({ error: "Telefone inválido." }, 400);
  if (!consent) return json({ error: "É preciso autorizar o uso dos dados." }, 400);
  if (!verdade) return json({ error: "Confirme que as informações são verdadeiras." }, 400);

  // --- Currículo (obrigatório) ---
  const file = form.get("curriculo");
  if (!(file instanceof File) || file.size === 0) return json({ error: "Anexe seu currículo (PDF, DOC ou DOCX)." }, 400);
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  if (!EXT_OK[ext]) return json({ error: "Formato não aceito. Envie PDF, DOC ou DOCX." }, 400);
  if (file.size > MAX_BYTES) return json({ error: "Arquivo muito grande (máx. 8 MB)." }, 400);

  // --- Rate-limit / duplicado (mesmo e-mail ou telefone nas últimas 24h) ---
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data: dup } = await supabase.from("mr_candidatos")
    .select("id").gte("created_at", since)
    .or(`email.eq.${email},telefone.eq.${tel}`).limit(1);
  if (dup && dup.length) {
    return json({ ok: true, duplicate: true,
      message: "Já recebemos sua candidatura recentemente. Obrigado!" });
  }

  // --- Vaga (opcional) — título autoritativo quando vem por link de vaga ---
  const vagaId = get("vaga_id") || null;
  let vagaTitulo = get("vaga_titulo"); // área/cargo (candidatura espontânea)
  if (vagaId) {
    const { data: v } = await supabase.from("mr_vagas").select("titulo,status").eq("id", vagaId).maybeSingle();
    if (!v) return json({ error: "Vaga não encontrada." }, 404);
    if (v.status === "encerrada") return json({ error: "Esta vaga foi encerrada e não está mais recebendo candidaturas." }, 400);
    vagaTitulo = v.titulo; // autoritativo
  }

  // --- ID + upload do currículo ---
  const id = "cand_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  const path = `${id}/${slug(file.name)}`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const up = await supabase.storage.from("curriculos")
    .upload(path, bytes, { contentType: file.type || EXT_OK[ext], upsert: false });
  if (up.error) return json({ error: "Falha ao enviar o currículo. Tente novamente." }, 500);

  // --- Respostas completas do formulário ---
  const respostas = {
    trabalhando_atualmente:   get("trabalhando_atualmente"),
    ultima_experiencia:       get("ultima_experiencia"),
    tempo_ultimo_emprego:     get("tempo_ultimo_emprego"),
    motivo_saida:             get("motivo_saida"),
    pretensao_salarial:       get("pretensao_salarial"),
    disponibilidade_horario:  get("disponibilidade_horario"),
    disponibilidade_apos_18h: get("disponibilidade_apos_18h"),
    fumante:                  get("fumante"),
    sobre_voce:               get("sobre_voce"),
    por_que_trabalhar:        get("por_que_trabalhar"),
  };

  const nowISO = new Date().toISOString();
  const row = {
    id, vaga_id: vagaId, vaga_titulo: vagaTitulo || null, etapa: "novos",
    nome, email, telefone: tel,
    data_nascimento: get("data_nascimento") || null,
    cidade: get("cidade") || null, bairro: get("bairro") || null,
    escolaridade: get("escolaridade") || null,
    origem: get("origem") || null,
    curriculo_path: path, curriculo_nome: file.name,
    respostas,
    historico: [{ data: nowISO, texto: "Candidatura recebida pelo formulário público", tipo: "entrada" }],
    consentimento: true, consentimento_at: nowISO, veracidade: true,
    created_at: nowISO,
  };

  const { error } = await supabase.from("mr_candidatos").insert(row);
  if (error) {
    await supabase.storage.from("curriculos").remove([path]); // rollback do arquivo
    return json({ error: "Não foi possível registrar sua candidatura. Tente novamente." }, 500);
  }

  return json({ ok: true });
});
