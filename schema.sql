-- ============================================================================
--  Método Real · CRM — Grupo Real
--  Esquema do banco (Supabase / PostgreSQL) + segurança por usuário (RLS).
--
--  Como usar:
--    1. No projeto Supabase, abra  SQL Editor → New query
--    2. Cole TODO este arquivo e clique em  Run
--  Cada usuário (login) só enxerga e edita os próprios clientes.
-- ============================================================================

-- Extensão para gerar UUIDs (já vem habilitada na maioria dos projetos)
create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
--  Tabela principal: clientes da consultoria
-- ----------------------------------------------------------------------------
create table if not exists public.mr_companies (
  id                  text primary key,                       -- id gerado no app (ex.: c_xxxx)
  user_id             uuid not null references auth.users(id) on delete cascade,

  -- Identificação (Ficha de Cliente)
  nome                text not null,                          -- Cliente (empresa)
  setor               text,                                   -- Setor / Segmento
  cidade              text,                                   -- Cidade / UF
  decisor             text,                                   -- Decisor principal
  faturamento         text,                                   -- Faturamento médio (texto livre)

  -- Funil + contrato
  fase                text default 'entrega',                 -- 'venda' (funil comercial) | 'entrega' (Método)
  etapa_venda         text,                                   -- coluna do funil de vendas: lead|qualificado|call|proposta|followup|ganho|perdido
  etapa               text not null default 'diagnostico',    -- coluna do funil de entrega (Roadmap)
  data_proposta       date,                                   -- quando a proposta foi enviada (cadência de follow-up)
  ultimo_contato      date,                                   -- último follow-up feito (reprograma o próximo toque)
  status              text default 'Lead',                    -- Lead | Em proposta | Ativo | Pausado | Encerrado | Perdido
  plano               text,                                   -- '' | plano1 | plano2 | plano3
  valor_mensal        numeric,                                -- valor negociado real (sobrepõe o preço de tabela do plano)
  sessoes_realizadas  integer default 0,

  data_inicio         date,
  data_fim            date,
  proxima_sessao      date,

  -- Links
  whatsapp            text,                                   -- WhatsApp do grupo (URL)
  drive               text,                                   -- Drive do cliente (URL)

  -- Conteúdo da ficha
  dor                 text,                                   -- Principal dor
  prioridades         text,                                   -- 3 prioridades acordadas
  notas               text,                                   -- Notas e observações

  -- Estruturados
  atas                jsonb default '[]'::jsonb,              -- [{data, texto, fonte?, titulo?, resumo?, acoes?}]
  deliverables        jsonb default '{}'::jsonb,              -- {diagnostico:[bool], cultura:[...], ...}
  onboarding          jsonb default '{}'::jsonb,              -- dados cadastrais + checklist pós-fechamento (POP 02)
  qualificacao        jsonb default '{}'::jsonb,              -- ICP (POP 01): {crit:[bool], planoSugerido, motivo}
  contatos            jsonb default '[]'::jsonb,              -- até 5 [{nome, email}] p/ vincular reuniões do Tactiq
  interacoes          jsonb default '[]'::jsonb,              -- [{data, tipo, texto}] log de contatos/atendimentos

  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);

-- Busca rápida dos registros do usuário, mais recentes primeiro
create index if not exists mr_companies_user_idx on public.mr_companies (user_id, updated_at desc);

-- ----------------------------------------------------------------------------
--  Segurança em nível de linha (RLS)
--  -> cada usuário só acessa o que é dele.
-- ----------------------------------------------------------------------------
alter table public.mr_companies enable row level security;

drop policy if exists "mr_select_own" on public.mr_companies;
create policy "mr_select_own" on public.mr_companies
  for select using (auth.uid() = user_id);

drop policy if exists "mr_insert_own" on public.mr_companies;
create policy "mr_insert_own" on public.mr_companies
  for insert with check (auth.uid() = user_id);

drop policy if exists "mr_update_own" on public.mr_companies;
create policy "mr_update_own" on public.mr_companies
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "mr_delete_own" on public.mr_companies;
create policy "mr_delete_own" on public.mr_companies
  for delete using (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
--  Mantém updated_at sempre atualizado
-- ----------------------------------------------------------------------------
create or replace function public.mr_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists mr_companies_touch on public.mr_companies;
create trigger mr_companies_touch
  before update on public.mr_companies
  for each row execute function public.mr_touch_updated_at();

-- ----------------------------------------------------------------------------
--  Integração Tactiq: caixa de entrada de transcrições não atribuídas
--  -> quando o webhook recebe uma reunião mas não consegue casar com 1 cliente
--     (nenhum e-mail bateu, ou bateu em vários), a ata cai aqui pra atribuição
--     manual no app. A Edge Function grava com a service key; o app lê pelo RLS.
-- ----------------------------------------------------------------------------
create table if not exists public.mr_tactiq_inbox (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete cascade,   -- dono (consultor presente na call)
  titulo      text,
  data        date,
  emails      jsonb default '[]'::jsonb,        -- participantes da reunião (sem o consultor)
  resumo      text,                             -- resumo AI do Tactiq
  acoes       text,                             -- action items
  texto       text,                             -- transcrição completa
  motivo      text,                             -- 'sem_match' | 'multiplos_matches'
  candidatos  jsonb default '[]'::jsonb,        -- [{id, nome}] quando houve mais de um possível
  resolvido   boolean default false,
  created_at  timestamptz default now()
);

create index if not exists mr_tactiq_inbox_user_idx
  on public.mr_tactiq_inbox (user_id, resolvido, created_at desc);

alter table public.mr_tactiq_inbox enable row level security;

-- O consultor só vê / mexe na própria caixa de entrada.
drop policy if exists "mr_inbox_select_own" on public.mr_tactiq_inbox;
create policy "mr_inbox_select_own" on public.mr_tactiq_inbox
  for select using (auth.uid() = user_id);

drop policy if exists "mr_inbox_update_own" on public.mr_tactiq_inbox;
create policy "mr_inbox_update_own" on public.mr_tactiq_inbox
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "mr_inbox_delete_own" on public.mr_tactiq_inbox;
create policy "mr_inbox_delete_own" on public.mr_tactiq_inbox
  for delete using (auth.uid() = user_id);
-- (sem policy de INSERT: só a Edge Function grava, usando a service role key)

-- ============================================================================
--  MÓDULO RECRUTAMENTO & SELEÇÃO
--  Board de EQUIPE (qualquer usuário logado vê/edita). Candidaturas entram
--  pelo formulário público (candidatura.html) via Edge Function
--  candidatura-submit (service role, ignora RLS). Currículos no bucket privado
--  'curriculos'. LGPD: acesso restrito a logados; consentimento gravado;
--  exclusão total pela ficha do candidato.
-- ============================================================================
create table if not exists public.mr_vagas (
  id text primary key, titulo text not null, descricao text, local text,
  status text default 'aberta',                     -- aberta | pausada | encerrada
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create table if not exists public.mr_recruta_etapas (
  id text primary key, nome text not null, cor text default '#c9a227',
  ordem int not null default 0, created_at timestamptz default now()
);
create table if not exists public.mr_candidatos (
  id text primary key,
  vaga_id text references public.mr_vagas(id) on delete set null,
  vaga_titulo text, etapa text not null default 'novos', responsavel text,
  nome text not null, data_nascimento date, cidade text, bairro text,
  telefone text, email text, escolaridade text, origem text,
  curriculo_path text, curriculo_nome text,
  respostas jsonb default '{}'::jsonb,
  historico jsonb default '[]'::jsonb, anotacoes jsonb default '[]'::jsonb,
  avaliacao jsonb default '{}'::jsonb, entrevistas jsonb default '[]'::jsonb,
  testes jsonb default '{}'::jsonb, motivo_decisao text,
  proxima_acao text, proxima_acao_data date,
  consentimento boolean default false, consentimento_at timestamptz, veracidade boolean default false,
  arquivado boolean default false,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create index if not exists mr_candidatos_etapa_idx on public.mr_candidatos (etapa, created_at desc);
create index if not exists mr_candidatos_vaga_idx  on public.mr_candidatos (vaga_id);
create index if not exists mr_candidatos_busca_idx on public.mr_candidatos (email, telefone);

drop trigger if exists mr_vagas_touch on public.mr_vagas;
create trigger mr_vagas_touch before update on public.mr_vagas
  for each row execute function public.mr_touch_updated_at();
drop trigger if exists mr_candidatos_touch on public.mr_candidatos;
create trigger mr_candidatos_touch before update on public.mr_candidatos
  for each row execute function public.mr_touch_updated_at();

alter table public.mr_vagas          enable row level security;
alter table public.mr_recruta_etapas enable row level security;
alter table public.mr_candidatos     enable row level security;
drop policy if exists "mr_vagas_all"  on public.mr_vagas;
create policy "mr_vagas_all"  on public.mr_vagas          for all to authenticated using (true) with check (true);
drop policy if exists "mr_etapas_all" on public.mr_recruta_etapas;
create policy "mr_etapas_all" on public.mr_recruta_etapas for all to authenticated using (true) with check (true);
drop policy if exists "mr_cand_all"   on public.mr_candidatos;
create policy "mr_cand_all"   on public.mr_candidatos     for all to authenticated using (true) with check (true);

insert into public.mr_recruta_etapas (id, nome, cor, ordem) values
  ('novos','Novos currículos','#c9a227',1),('triagem','Triagem','#6b7cff',2),
  ('contato','Contato realizado','#3fa9f5',3),('entrevista_agendada','Entrevista agendada','#8a63d2',4),
  ('entrevista_realizada','Entrevista realizada','#b06fd0',5),('teste_comportamental','Teste comportamental','#e08a2b',6),
  ('teste_pratico','Teste prático','#e0662b',7),('aprovado','Aprovado','#2fb36b',8),
  ('banco_talentos','Banco de talentos','#8a8f98',9),('reprovado','Reprovado','#e0524d',10),
  ('contratado','Contratado','#1f9d55',11)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public) values ('curriculos','curriculos',false) on conflict (id) do nothing;
drop policy if exists "mr_curriculos_read" on storage.objects;
create policy "mr_curriculos_read" on storage.objects for select to authenticated using (bucket_id='curriculos');
drop policy if exists "mr_curriculos_del" on storage.objects;
create policy "mr_curriculos_del" on storage.objects for delete to authenticated using (bucket_id='curriculos');

-- ============================================================================
--  Pronto. Volte ao app, preencha SUPABASE_URL e SUPABASE_ANON_KEY no index.html.
-- ============================================================================
