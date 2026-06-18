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
  atas                jsonb default '[]'::jsonb,              -- [{data, texto}]
  deliverables        jsonb default '{}'::jsonb,              -- {diagnostico:[bool], cultura:[...], ...}
  onboarding          jsonb default '{}'::jsonb,              -- dados cadastrais + checklist pós-fechamento (POP 02)
  qualificacao        jsonb default '{}'::jsonb,              -- ICP (POP 01): {crit:[bool], planoSugerido, motivo}

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

-- ============================================================================
--  Pronto. Volte ao app, preencha SUPABASE_URL e SUPABASE_ANON_KEY no index.html.
-- ============================================================================
