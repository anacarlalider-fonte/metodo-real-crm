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

## 🎙 Integração com o Tactiq (atas automáticas das reuniões)

Quando o **Tactiq** termina de transcrever uma reunião, a ata entra **sozinha** na ficha do
cliente certo — o sistema descobre qual cliente é pelo **e-mail de quem participou da call**.

### Como o sistema sabe de qual cliente é a reunião
Na ficha de cada empresa existe o bloco **🎙 Contatos para vincular reuniões (Tactiq)**.
Cadastre ali até **5 pessoas** (nome + e-mail) com quem você fala naquela empresa. Quando o
Tactiq mandar a reunião, o sistema:
- pega os e-mails dos participantes,
- ignora o **seu** e-mail (você sempre está na call),
- e procura uma empresa que tenha algum desses e-mails nos contatos.

➡️ **Bateu em 1 empresa:** a ata cai direto na ficha dela (com selo *🎙 Tactiq*, resumo e próximos passos).
➡️ **Não bateu, ou bateu em mais de uma:** a ata vai pra **Caixa de entrada** (aviso no topo do app).
Clique em **Revisar**, escolha o cliente e clique **Vincular**. Nada se perde.

> Dica: pra o vínculo automático funcionar, o e-mail que a pessoa usa na reunião (Google
> Meet / Zoom) precisa ser o **mesmo** cadastrado no contato.

### Ligar o Tactiq → CRM (uma vez, ~5 min, sem código)
Feito pelo **Zapier** (plano grátis dá conta de poucas reuniões/mês).

1. No Zapier, **Create Zap**.
2. **Gatilho (Trigger):** app **Tactiq** → evento **“Meeting Transcript Is Ready”**. Conecte sua conta Tactiq.
   - *Para vir resumo e próximos passos, sua conta Tactiq precisa ter o resumo com IA ativo.*
3. **Ação (Action):** app **Webhooks by Zapier** → evento **POST**.
4. Configure a ação assim:
   - **URL:**
     ```
     https://vkuixvooivsqwmjymunk.functions.supabase.co/tactiq-webhook?token=d62fc71384da0e1aa76bdf107fce16b45612eb1370c1be7a
     ```
   - **Payload Type:** `json`
   - **Data** (cada linha é um campo → escolha o valor vindo do Tactiq):
     | Campo (esquerda) | Valor (direita — do Tactiq) |
     |---|---|
     | `title`        | título da reunião |
     | `date`         | data da reunião |
     | `attendees`    | **e-mails dos participantes** ← o mais importante |
     | `summary`      | resumo (AI summary) |
     | `action_items` | action items / pontos de ação |
     | `transcript`   | transcrição completa |
   - **Wrap Request In Array:** No · **Unflatten:** Yes · **Headers:** deixe em branco.
5. **Test** → deve responder `"ok": true`. Pronto, publique o Zap (**Publish**).

A partir daí, toda reunião transcrita pelo Tactiq aparece no CRM. No app, o botão **↻ Sincronizar**
(no topo) puxa as atas que chegaram desde que você abriu a página.

### Segredo do webhook
O `?token=...` na URL é a senha que protege o webhook — só o seu Zapier conhece. Se algum dia
quiser trocá-lo, crie o secret **`TACTIQ_WEBHOOK_SECRET`** nas *Edge Functions* do Supabase com o
novo valor e atualize a URL no Zapier. (A Edge Function fica em `supabase/functions/tactiq-webhook/`.)

---
**Arquivos:** `index.html` (o sistema), `schema.sql` (banco), `README.md` (este guia),
`supabase/functions/tactiq-webhook/` (recebe as reuniões do Tactiq).
A chave `anon` é pública por natureza — a segurança real está nas regras (RLS) que o `schema.sql` cria. Pode publicá-la sem medo.
