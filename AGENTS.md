# AGENTS.md — Diário de Estudos

Contexto para assistentes de IA (Cursor, Copilot, Claude Code, etc.). Leia antes de alterar o projeto.
Se a sua ferramenta usa outro nome de arquivo (`CLAUDE.md`, `.cursorrules`, `copilot-instructions.md`), copie este conteúdo para ele.

## O que é

Workspace de estudos para um estudante de Ciência da Computação (faculdade + programação). Cada usuário tem login, matérias com notas em Markdown, tarefas, pomodoro, projetos que "crescem" como plantas e um perfil personalizável (personagem pixelado ou imagem + username livre). Visual inspirado em Stardew Valley: cores leves, tranquilo, com enfeites em pixel art.

- Idioma da interface, textos e mensagens de erro: **português do Brasil**.
- Tom da UI: calmo e acolhedor ("Plantar matéria", "Horta de projetos", "Respire fundo e aproveite o dia").

## Stack

| Camada | Tecnologia |
|---|---|
| Backend | Node 20.12+ (testado no 22 e 24), Express 4, PostgreSQL (`pg`) em produção ou `better-sqlite3` local, `bcryptjs` 2.x, `jsonwebtoken`, `cookie-parser`, `google-auth-library` 10 |
| Frontend | React 18 + TypeScript (strict) + Vite 6, sem biblioteca de UI nem de CSS |
| Testes do cliente | Vitest + React Testing Library + jsdom (dependências de desenvolvimento) |
| Banco local | SQLite em `estudos.db` (criado automaticamente) |
| Banco produção | PostgreSQL do Supabase via `DATABASE_URL`/transaction pooler |
| Auth | JWT em cookie httpOnly (`token`, 30 dias) |

O backend é CommonJS (`require`). O frontend é ESM/TSX em `client/`.

## Comandos

```bash
npm ci                 # instala dependências do servidor e ferramentas locais pelo lockfile
npm run build          # instala e compila o frontend (client/dist)
npm test               # API/migrações/PostgreSQL (node:test) e interface (Vitest)
npm start              # servidor em http://localhost:3000 (serve client/dist)
npm run dev             # servidor com --watch

cd client
npm run dev            # Vite em :5173, com proxy /api -> :3000
npm ci                 # instala exatamente as dependências do lockfile
npm run build          # tsc --noEmit && vite build
npm run test:unit      # testes do cliente (Vitest + React Testing Library)
```

Antes de dar uma tarefa por concluída: rode `npm run build` dentro de `client/` (precisa passar no `tsc` estrito, incluindo `noUnusedLocals`).

## Estrutura

```
server.js                 API, auth, perfil e entrega local do frontend
db.js                     camada assíncrona SQLite local/PostgreSQL produção
database.js               schema SQLite e migrações compatíveis
api/[...path].js          entrada do Express para função Vercel
vercel.json               build, assets estáticos e roteamento
test/                     testes API, migração SQLite e adaptador PostgreSQL
.env.example              PORT, DATABASE_URL, DB_PATH, JWT_SECRET, GOOGLE_CLIENT_ID, NODE_ENV
client/
  vite.config.ts          proxy /api -> http://localhost:3000
  vitest.config.ts        ambiente jsdom e configuração dos testes do cliente
  test/                   testes de interface com mock local da API
  src/
    main.tsx              entrada; AuthProvider > App
    App.tsx               Shell (abas, header), useData, decide Login x Shell
    api.ts                tipos (User, Subject, Task, Project, AllData...) + api() + ApiError
    auth.tsx              AuthContext: user, loading, setUser, logout
    timer.ts              hook useTimer (pomodoro 25/5)
    lib.ts                esc, datas locais, byDue, md() (Markdown mínimo)
    pixel.tsx             Pix (renderiza pixel art em SVG), sprites, CharacterSprite, Avatar, Sky, Ground
    styles.css            todo o CSS (variáveis em :root)
    pages/
      Login.tsx           entrar / criar conta / botão do Google
      Today.tsx           pomodoro, minutos focados, próximas tarefas, horta de projetos
      Subjects.tsx        matérias + notas em Markdown (autosave)
      Tasks.tsx           tarefas com matéria e prazo
      Profile.tsx         username, avatar (personagem ou imagem), criador de personagem
```

Abas atuais: **Hoje, Matérias, Tarefas, Perfil**. A aba "Código" (snippets) foi removida de propósito. Não recrie sem o usuário pedir.

## Banco de dados

```
users(id, email UNIQUE, password_hash NULL, google_sub UNIQUE NULL, username, avatar_mode, avatar_image NULL, character TEXT[JSON])
subjects(id, name, color, notes, user_id)
tasks(id, title, subject_id NULL, project_id NULL, due '' ou YYYY-MM-DD, done 0/1, user_id)
projects(id, name, progress 0..100, user_id)
sessions(id, day YYYY-MM-DD, minutes, user_id)
```

- Todas as tabelas de dados têm `user_id` com `ON DELETE CASCADE`.
- Há uma migração no início de `server.js` que adiciona `user_id` em bancos da v1 (sem login) e `project_id` em bancos que ainda não têm esse campo. `project_id` referencia `projects(id)` com `ON DELETE SET NULL`. Os dados antigos (`user_id IS NULL`) passam a pertencer ao **primeiro usuário cadastrado**.
- Contas novas começam sem matérias, tarefas ou projetos de exemplo.
- Cada tarefa pode pertencer a um projeto. O progresso do projeto é calculado como `tarefas concluídas / total de tarefas vinculadas`; projeto sem tarefas fica em 0%. A API recalcula esse valor ao consultar os dados e após criar, concluir/reabrir, mover ou excluir tarefas.
- Não existe mais tabela de snippets no schema novo.

## API

Tudo em `/api`. Exigem login (cookie) todas as rotas, exceto `GET /config` e `POST /auth/*`.

```
GET    /api/config                      { googleClientId | null }
POST   /api/auth/register               { email, password(8..72), username? }
POST   /api/auth/login                  { email, password }
POST   /api/auth/google                 { credential }   (501 se GOOGLE_CLIENT_ID não estiver configurado)
POST   /api/auth/logout
GET    /api/me
PUT    /api/me                          { username?, character?, avatarImage? (dataURL | null), avatarMode? }
GET    /api/all                         { subjects, tasks[{..., project_id}], projects, sessions: {YYYY-MM-DD: minutos} }
POST   /api/subjects   PUT/DELETE /api/subjects/:id      (PUT: name?, notes?)
POST   /api/tasks      { title, subject_id?, project_id?, due? }
PATCH  /api/tasks/:id  { done?, project_id? }
DELETE /api/tasks/:id
POST   /api/projects
DELETE /api/projects/:id
POST   /api/sessions                    { minutes, day }
```

O progresso não pode ser alterado manualmente pela API nem pela interface. É derivado das tarefas vinculadas, arredondado para porcentagem inteira; projetos sem tarefas ficam em 0%.

### Regras de segurança (não quebrar)

1. **Toda query de dados filtra por `user_id = req.user.id`**, inclusive UPDATE e DELETE. Ao criar rota nova, siga o mesmo padrão.
2. Ao criar tarefa com `subject_id`, o servidor confere se a matéria pertence ao usuário; senão grava `NULL`.
3. Ao criar/associar tarefa com `project_id`, o servidor confere se o projeto pertence ao usuário; senão grava `NULL`. O cálculo do progresso só considera tarefas e projetos do usuário autenticado.
4. Validação é sempre no servidor (o frontend só ajuda). Ex.: `cleanChar` rejeita personagem fora dos limites.
5. Login/cadastro têm rate limit em memória (20 tentativas por IP a cada 15 min). Resposta de login errado é genérica.
6. Nunca commitar `.env`, `.jwt-secret` nem `estudos.db` (já estão no `.gitignore`).
7. `JWT_SECRET` vem do ambiente; se vazio, é gerado e salvo em `.jwt-secret`.

## Autenticação

- E-mail e senha: bcrypt (`bcryptjs`), cookie `token` httpOnly, `sameSite=lax`, `secure` só com `NODE_ENV=production`.
- Google: o frontend carrega o script do Google Identity Services e envia o `credential` (ID token). O servidor valida com `verifyIdToken` usando `GOOGLE_CLIENT_ID`. Se o e-mail verificado já existir, a conta é vinculada (`google_sub` preenchido); senão cria usuário novo.
- O `GOOGLE_CLIENT_ID` chega ao frontend por `GET /api/config` (não há variável `VITE_*`).
- Sessão expirada: `useData` recebe 401 em `/all` e chama `setUser(null)`, voltando para o Login.

## Perfil e personagem

`character` é um JSON com índices inteiros. **Os limites precisam ficar idênticos em dois lugares**: `MAX` em `server.js` e os arrays de `client/src/pixel.tsx`.

| Chave | Significado | Faixa |
|---|---|---|
| `skin` | tom de pele (`SKIN`) | 0–4 |
| `hair` | estilo (careca, curto, longo, coque, espetado) | 0–4 |
| `hc` | cor do cabelo (`HAIR_COLORS`) | 0–5 |
| `shirt` | cor da roupa (`CLOTHES`) | 0–5 |
| `style` | roupa lisa ou listrada | 0–1 |
| `acc` | acessório (nenhum, chapéu, óculos, flor) | 0–3 |
| `ac` | cor do acessório (`CLOTHES`) | 0–5 |
| `bg` | cor de fundo do avatar (`BACKGROUNDS`) | 0–5 |

- O personagem é uma grade 12×16 em strings (`BODY` + camadas `HAIR` e `ACC`), desenhada como `<rect>` SVG pelo componente `Pix`. Para adicionar opção nova: aumente o array no frontend **e** o `MAX` no servidor.
- Avatar por imagem: o navegador recorta em quadrado e reduz para 192×192 (`toAvatar` em `Profile.tsx`), enviando como data URL `png|jpeg|webp` (máx. ~400 mil caracteres, validado por regex no servidor). Se `avatarMode` for `image` sem imagem salva, vira `character`.
- **Username é livre** (até 30 caracteres, qualquer símbolo ou emoji, sem unicidade). É guardado cru; o React escapa na renderização. Não use `dangerouslySetInnerHTML` com username.

## Convenções do frontend

- **Padrão de mutação:** `act(() => api(...))` executa a chamada e depois recarrega `/api/all` inteiro (`useData` em `App.tsx`). Para tarefas, passe também uma atualização otimista de `AllData`: a interface atualiza imediatamente, sem recarga após sucesso; em falha, recarrega os dados do servidor e mostra o alerta padrão. Ao mudar tarefas vinculadas, recalcule também o progresso otimista do projeto.
- O estado do timer vive no `Shell` (`useTimer`), para continuar rodando ao trocar de aba. Minutos focados são gravados ao pausar ou concluir um ciclo, em minutos inteiros acumulados; `POST /sessions` usa o dia **local** (`today()` de `lib.ts`).
- `Subjects`: autosave das notas com debounce de 600 ms. O `useEffect` que sincroniza `notes` depende só de `s?.id` de propósito (evita sobrescrever o que o usuário está digitando).
- `Tasks`: criação aceita matéria, projeto e prazo; a lista indica o projeto vinculado. A tela Hoje também mostra o projeto nas próximas tarefas.
- `Tasks`: cada tarefa pode ser movida para outro projeto ou desvinculada pelo seletor de projeto na própria linha.
- Progresso de projeto é derivado das tarefas concluídas; mudanças de conclusão, reabertura, movimentação e exclusão atualizam o percentual otimisticamente e revertem ao estado do servidor se a mutação falhar.
- Nas rotas de tarefa, valide matéria/projeto dentro da instrução de gravação; recalcule em uma única instrução o progresso dos projetos afetados. Mantenha a compatibilidade SQL com SQLite e PostgreSQL.
- Desenvolvimento local usa SQLite por padrão; produção exige `DATABASE_URL` e usa PostgreSQL. A camada em `db.js` expõe operações assíncronas e transações; novas queries devem continuar limitadas por `user_id`.
- PostgreSQL do Supabase usa schema idempotente inicializado pelo backend. Na Vercel, configurar `DATABASE_URL` com Transaction pooler e `DATABASE_CA_CERT` com o certificado raiz PEM do Supabase para validar TLS; nunca expor a URL ao cliente nem registrá-la em logs.
- `better-sqlite3` e `pg-mem` ficam em `devDependencies`; `pg` é dependência de runtime. Dados do SQLite local não são transferidos automaticamente ao Supabase.
- `Today > ProjectRow` exibe a planta, uma barra acessível somente de leitura (`role="progressbar"`) e o percentual. Não reintroduzir slider manual.
- Grupos de opções do personagem no perfil usam `radiogroup`/`radio`: Tab entra no valor selecionado e as setas, Home e End permitem escolher sem percorrer cada opção individualmente.
- Falhas em mutações feitas por `act` devem continuar visíveis ao usuário; `useData` em `App.tsx` as apresenta como alerta e permite dispensá-las.
- `md()` em `lib.ts` escapa o HTML antes de aplicar Markdown, e só então é usado com `dangerouslySetInnerHTML`. Se mudar o parser, mantenha o escape primeiro.
- Sem bibliotecas extras de runtime ou bibliotecas de UI: antes de adicionar dependência de produção, veja se dá para resolver com o que existe. Ferramentas de teste ficam em `devDependencies`.
- Código TypeScript estrito: nada de `any` sem comentário justificando (o botão do Google é a única exceção hoje).

## Design (Stardew Valley, leve e tranquilo)

- Variáveis em `:root` de `styles.css`: céu `--sky/--sky2`, pergaminho `--par/--par2/--box`, madeira `--wood/--wood2`, texto `--ink/--mut`, verdes `--g1/--g2`, sol `--sun`, erro `--bad`.
- Fontes: **Pixelify Sans** (títulos, relógio, abas) e **Nunito** (texto), via Google Fonts em `client/index.html`.
- Painéis com borda de madeira e sombra "dura"; botões com `box-shadow: 0 3px 0`; foco visível com outline azul; animação só nas nuvens, respeitando `prefers-reduced-motion`.
- Enfeites: sol e nuvens (`Sky`), gramado com flores (`Ground`), plantas por estágio de progresso (`seed < 25`, `sprout < 60`, `bud < 100`, `flower = 100`).
- Mantenha cores claras e o clima calmo. Evite tons saturados, vermelhos agressivos e animações rápidas.
- Tema único (claro). Não há modo escuro.

## Produção x desenvolvimento

- Dev: Vite em :5173 faz proxy de `/api` para :3000 (mesmo origin para o cookie).
- Produção na Vercel: o serviço `api` encaminha `/api/*` ao Express/PostgreSQL; o serviço `client` entrega os arquivos Vite e faz fallback de SPA. Ambos compartilham o mesmo domínio e cookies.
- Para publicar na Vercel: configure HTTPS, `DATABASE_URL` do Supabase e `JWT_SECRET`; cadastre a origem pública do site nas origens autorizadas do Google. `estudos.db` é apenas local, não usar filesystem da Vercel para persistência.

## Estado atual

Feito e verificado:
- Build TypeScript/Vite do cliente aprovado após a integração de tarefas e projetos.
- Vite atualizado para 6.4.4 (Node 20+); `google-auth-library` atualizado para 10.9.1 (Node 18+).
- `npm audit` na raiz e em `client/` sem vulnerabilidades após atualizar os pacotes acima.
- No navegador real, cadastro de usuário novo resultou em lista de matérias vazia.
- No navegador real, criar um projeto e duas tarefas associadas e concluir uma exibiu progresso de 50%.
- No navegador real, o seletor moveu uma tarefa para outro projeto; os percentuais foram atualizados (100% no projeto restante e 0% no novo).
- No navegador real, a barra acessível foi exibida sem slider manual.
- Os dados usados na validação de interface ficaram em um banco temporário isolado, removido ao final.
- Revisão visual/acessível em instância e banco temporários: abas Hoje, Matérias, Tarefas e Perfil verificadas em viewport 1280px e 375px sem overflow horizontal; foco visível confirmado por teclado.
- A navegação das quatro abas foi mantida em uma única linha em telas pequenas; confirmado no navegador em 375px e 320px, sem quebra de linha nem overflow no documento.
- No criador de personagem, 8 grupos agora têm um único ponto de parada por Tab (antes cada opção era uma parada); navegação por setas e End foi confirmada no navegador.
- A lista de tarefas anuncia título junto à ação de concluir/reabrir; o gráfico semanal anuncia os minutos de cada dia; uma falha simulada de mutação apareceu como alerta dispensável.
- Banco e servidor temporários usados nesta revisão foram isolados dos dados locais do usuário.
- `npm test` executa 4 testes de integração da API/migração, 1 teste do adaptador PostgreSQL em `pg-mem` e 5 testes de interface com Vitest/React Testing Library: navegação e criação de matéria em conta vazia, autosave/renderização Markdown, ciclo de tarefa/projeto, teclado e salvamento do perfil, e anúncio de falhas de mutação.
- A suíte de API também testa o schema/adaptador PostgreSQL em `pg-mem`. Isso valida SQL básico e transações no emulador, mas não substitui teste de conexão, pooler, SSL e fluxo completo contra Supabase real.
- Os testes de interface simulam a API em memória no navegador jsdom; não exigem servidor nem alteram o banco local.
- Vitest ficou em versão corrigida após o audit apontar advisories na versão inicial; `npm audit` na raiz e no cliente retornou zero vulnerabilidades.
- A configuração Vercel + Supabase em `vercel.json` declara os serviços `api` (Express) e `client` (Vite) com rotas públicas no mesmo domínio. O entrypoint da API é `api/[...path].js`; o pooler, segredos, origem OAuth e deploy real ainda precisam de configuração/verificação manual.
- Cadastro, login, logout, validações, perfil, personagem, imagem de avatar e isolamento entre usuários foram testados anteriormente.
- Login Google: fluxo real concluído e confirmado pelo usuário em navegador em 2026-10-09; fluxo da rota também coberto por testes com verificador/token simulado (client ID, token ausente/inválido, e-mail não verificado, criação e vinculação de conta).
- `GOOGLE_CLIENT_ID` está configurado localmente em `.env` (arquivo ignorado pelo Git); `/api/config` retorna exatamente o ID configurado. Usuário confirmou que `http://localhost:3000` e `http://localhost:5173` estão em Authorized JavaScript origins do mesmo OAuth Client.

Testes automatizados de API/migração ficam em `test/` e usam `node:test`, bancos isolados via `DB_PATH` e SQLite em memória para migrações. Os testes de interface ficam em `client/test/` e rodam via Vitest em jsdom com mock local da API. `npm test` executa ambas as suítes e o teste do adaptador PostgreSQL em `pg-mem`.

**Não verificado**: leitura com leitor de tela, revisão exaustiva de todos os estados/fluxos visuais, upload de imagem e timer nos testes automatizados do cliente. O criador de personagem foi revisado por teclado e viewport e há teste automatizado da navegação por teclado, mas não de todos os valores nem com leitor de tela. O adaptador foi exercitado em `pg-mem`, mas ainda falta smoke test contra Supabase real. Configuração de projetos/segredos Vercel e Supabase, autorização OAuth da origem de produção e transferência de dados SQLite são etapas manuais pendentes. O login real com Google foi confirmado pelo usuário.

## Lacunas conhecidas / ideias

- Recuperação de senha e verificação de e-mail no cadastro.
- Rate limit persistente (hoje zera ao reiniciar).
- Flashcards com repetição espaçada, calendário de provas.
- Expandir testes do cliente para login, upload de imagem, timer, filtros e exclusão/confirmação de matérias e tarefas.
- Deploy (Render, Railway ou Fly.io).

## Ao trabalhar neste projeto

1. Entenda o padrão existente e siga-o em vez de introduzir outro.
2. Mudanças de schema: faça migração compatível (como a de `user_id`), sem apagar dados.
3. Textos novos de UI em português do Brasil, no tom calmo do app.
4. Rode o build do cliente e teste as rotas afetadas antes de concluir.
5. Diga claramente o que **não** foi testado.