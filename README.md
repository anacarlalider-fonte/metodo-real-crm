# Método Real · CRM — Guia de publicação

CRM da consultoria **Grupo Real**, construído sobre o **Método Real**: um funil Kanban que une
o caminho comercial (Lead → Em proposta) com o Roadmap de entrega em 6 etapas
(Diagnóstico → Cultura → Gestão → Liderança → Comercial → Escala), com a ficha completa de cada
cliente e o checklist de entregáveis por pilar.

O sistema está pronto. Hoje ele roda em **modo demonstração** (dados só no navegador).
Pra virar o sistema completo, com login e acesso de qualquer lugar, são 4 passos — leva uns 15 minutos.

## O que o sistema faz
Barra lateral com 5 módulos:
- **▦ Funil (Kanban):** arraste cada empresa entre as etapas; o status é sincronizado automaticamente.
- **👥 Clientes:** tabela com todos os clientes (plano, etapa, status, progresso, próxima sessão), com busca.
- **🗓 Agenda:** próximas sessões agrupadas em Atrasadas / Próximos 7 dias / Mais adiante.
- **📊 Painel:** clientes ativos, receita recorrente (MRR), pipeline em proposta, progresso médio, distribuição por etapa e por plano.
- **🌟 Método:** referência dos 4 pilares + Roadmap de 6 etapas.

Na ficha de cada cliente:
- **Campos da Ficha de Cliente:** setor, cidade, decisor, faturamento, plano, datas, sessões, WhatsApp do grupo, Drive, dor, prioridades.
- **Entregáveis do Método:** checklists dos 6 pilares (Diagnóstico, Cultura, Gestão, Liderança, Vendas, Escala) com % de progresso.
- **Atas das sessões** e **notas**.
- **📤 Relatório de progresso (para o cliente):** gera mensagem pronta pra WhatsApp (copiar com 1 clique) e relatório visual/PDF mostrando a fase atual, o roadmap, o que já foi entregue e os próximos passos — automático a partir dos entregáveis marcados.

**Backup / Importação** em `.json` no topo de qualquer módulo.

## 1. Criar o banco dedicado (Supabase)
- Em supabase.com, crie um projeto novo (ex.: `CRM_Metodo_Real`), região **São Paulo (sa-east-1)**.
- *Obs.: o plano grátis permite 2 projetos ativos. Se já estiver no limite, pause/exclua um que não usa, ou suba pro plano Pro.*

## 2. Montar as tabelas e a segurança
- No projeto, abra **SQL Editor → New query**.
- Cole todo o conteúdo de `schema.sql` e clique em **Run**.
- Isso cria a tabela `mr_companies` com segurança por usuário (cada login só vê o que é seu).

## 3. Ligar o login instantâneo (opcional, recomendado)
- Em **Authentication → Sign In / Providers → Email**, desative **"Confirm email"**.
- Assim você cria sua conta no app e já entra direto, sem precisar confirmar por e-mail.
- *(Se deixar ligado, funciona também — só clica no link que chega no seu e-mail na primeira vez.)*

## 4. Conectar e publicar
- Em **Project Settings → API**, copie a **Project URL** e a chave **anon / publishable**.
- No arquivo `index.html`, no topo do `<script>`, preencha:
  ```js
  const SUPABASE_URL = "https://SEU-PROJETO.supabase.co";
  const SUPABASE_ANON_KEY = "sua-chave-anon";
  ```
- Publique na **Vercel**: crie um repositório no GitHub com esses arquivos (ou arraste a pasta no painel da Vercel), e em **Add New → Project** aponte pra ele. Como é um site estático, não precisa configurar build.
- Pronto: você recebe um endereço tipo `metodoreal.vercel.app`. Abre, cria sua conta com e-mail e senha, e o sistema está no ar.

## Migrar os dados do modo demonstração
- Antes de conectar, no app clique em **↓ Backup** pra baixar o arquivo `.json`.
- Depois de publicado e logado, clique em **↑ Importar** e selecione esse `.json` — os clientes sobem pra sua conta na nuvem.

---
**Arquivos:** `index.html` (o sistema), `schema.sql` (banco), `README.md` (este guia).
A chave `anon` é pública por natureza — a segurança real está nas regras (RLS) que o `schema.sql` cria. Pode publicá-la sem medo.
