# Diário de Estudos

Workspace de estudos com login, perfil personalizável (personagem pixelado ou imagem) e visual inspirado em Stardew Valley.

- **Backend:** Node 20.12+ + Express, SQLite local ou PostgreSQL no Supabase, autenticação com JWT em cookie httpOnly e senhas com bcrypt
- **Frontend:** React + TypeScript + Vite 6 (`client/`)

## Como rodar

Requisitos: Node 20.12 ou mais novo. A lista de requisitos funcionais e de execução está em [REQUIREMENTS.md](./REQUIREMENTS.md). As dependências JavaScript são declaradas nos `package.json` e fixadas pelos arquivos `package-lock.json`; não usamos `requirements.txt`, que é o formato de dependências Python.

```bash
cp .env.example .env     # opcional, veja "Configuração"
npm ci                   # instala dependências do backend pelo lockfile
npm run build            # instala dependências do cliente e compila client/dist
npm test                 # testes da API/migrações (node:test) e da interface (Vitest)
npm audit                # verifica dependências do backend
npm --prefix client audit # verifica dependências do frontend
npm start
```

Abra http://localhost:3000, crie uma conta e pronto. O banco `estudos.db` é criado sozinho.

### Modo desenvolvimento (hot reload)

Em dois terminais:

```bash
npm run dev                       # API em :3000 (reinicia ao salvar)
cd client && npm ci && npm run dev   # interface em http://localhost:5173
```

## Configuração (`.env`)

| Variável | Para quê |
|---|---|
| `PORT` | Porta do servidor (padrão 3000) |
| `JWT_SECRET` | Segredo dos tokens. Se vazio, um segredo é gerado em `.jwt-secret` (ignorado pelo git) |
| `GOOGLE_CLIENT_ID` | Habilita o botão "Continuar com o Google" |
| `NODE_ENV` | Use `production` ao publicar (cookie só via HTTPS) |
| `DATABASE_URL` | Conexão PostgreSQL; obrigatória quando `NODE_ENV=production`. Na Vercel, use a connection string do pooler em modo transaction do Supabase |
| `DATABASE_CA_CERT` | Certificado raiz PEM do Supabase para validar a conexão TLS se a autoridade certificadora não estiver no sistema |
| `DB_PATH` | Caminho alternativo do SQLite local; ignorado se `DATABASE_URL` estiver configurada |

No desenvolvimento local, sem `DATABASE_URL`, o app mantém o SQLite em `estudos.db`. Em produção, o servidor exige PostgreSQL e não cria um banco local efêmero.

### Login com Google

1. Acesse o [Google Cloud Console](https://console.cloud.google.com/) e crie um projeto.
2. Configure a tela de consentimento OAuth e adicione as contas de teste enquanto o app estiver em modo de testes.
3. Em **APIs e serviços → Credenciais**, crie um **ID do cliente OAuth** do tipo **Aplicativo da Web**.
4. Em **Origens JavaScript autorizadas**, adicione a origem que abre a interface: `http://localhost:3000` quando servido pelo Express ou `http://localhost:5173` no desenvolvimento Vite (e o domínio HTTPS quando publicar).
5. Copie o ID do cliente para `GOOGLE_CLIENT_ID` no `.env` do servidor e reinicie o servidor. O ID é público e enviado ao navegador por `/api/config`; nunca coloque segredo OAuth no frontend.

O app recebe a credencial do Google Identity Services e valida o ID token no backend usando o mesmo `GOOGLE_CLIENT_ID` como audience. Apenas tokens com `sub` e e-mail verificado são aceitos. Uma conta Google com e-mail já cadastrado vincula-se à conta existente; logins posteriores identificam a conta pelo `sub`.

Para validar localmente, confirme que `/api/config` retorna o client ID, abra a interface em uma das origens autorizadas no Console e complete o fluxo com uma conta autorizada na tela de consentimento. `npm test` cobre o contrato do backend com tokens simulados; o teste real com Google exige client ID configurado, navegador com acesso à internet e conta autorizada.

## Publicação gratuita na Vercel + Supabase

O repositório configura dois serviços Vercel no mesmo projeto e domínio: o serviço `client` publica a interface Vite e o serviço `api` executa o Express. As requisições a `/api/*` são encaminhadas à API; as demais chegam à interface, incluindo o fallback da SPA. Em produção, a API usa PostgreSQL no Supabase; SQLite permanece disponível para desenvolvimento e testes locais.

1. Crie um projeto no plano **Free** do [Supabase](https://supabase.com/dashboard). Guarde a senha do banco em local seguro.
2. No painel do Supabase, use **Connect** e selecione o **Transaction pooler** para obter a connection string compatível com funções serverless. Substitua o marcador da senha; caracteres especiais da senha precisam estar codificados na URL.
3. Envie o commit ao GitHub e importe o repositório na Vercel, mantendo a raiz como `./`. Aceite o preset `Services` se a Vercel o detectar a partir do `vercel.json`; não crie projetos separados para a interface e a API.
4. Nas configurações de SSL do banco no Supabase, baixe o certificado raiz e configure seu conteúdo PEM como `DATABASE_CA_CERT` na Vercel. Nas variáveis de ambiente de produção, configure também `DATABASE_URL` com a connection string do Supabase, `JWT_SECRET` com um segredo aleatório forte e `GOOGLE_CLIENT_ID` se usar login Google. A API valida o certificado do banco; não desative a validação TLS. A Vercel define `NODE_ENV=production` no deploy de produção.
5. Faça o primeiro deploy. O backend cria o schema PostgreSQL na inicialização. Depois, adicione a origem HTTPS exata atribuída ao projeto (por exemplo, `https://diario-de-estudos.vercel.app`, sem curingas) nas origens JavaScript autorizadas do OAuth no Google Cloud e teste cadastro, login e dados.

**Atenção ao plano gratuito:** Vercel Hobby é destinado a projetos pessoais e tem limites de uso. Projetos Supabase Free podem ser pausados após uma semana sem atividade e têm limites de banco/transferência; não incluem as mesmas garantias e backups dos planos pagos. Confirme os limites atuais nos painéis e termos da [Vercel](https://vercel.com/pricing) e do [Supabase](https://supabase.com/pricing). O deploy não deve gerar cobrança se a conta permanecer nos planos gratuitos e dentro dos limites, mas isso não é garantia permanente das plataformas.

O SQLite local não é copiado automaticamente para o Supabase. Antes de migrar dados existentes, faça backup do arquivo `estudos.db`; a transferência será uma etapa separada, com confirmação e validação, antes de qualquer uso real do banco remoto. As credenciais do banco nunca devem ir para o frontend, `.env.example`, GitHub ou logs.

#### Diagnóstico

| Sintoma | Verificação |
|---|---|
| A tela diz que o login está indisponível | Configure `GOOGLE_CLIENT_ID` no `.env` da raiz e reinicie o servidor. `/api/config` deve retornar o ID. |
| O Google informa que a origem não é permitida | Cadastre no Console a origem exata usada no navegador, incluindo protocolo e porta, sem caminho: por exemplo `http://localhost:5173`. |
| O servidor retorna “Não foi possível validar o login com Google” | Confirme que o client ID do `.env` é o mesmo usado na configuração do OAuth e que o credential não expirou. |
| O Google informa que o app está em modo de teste | Adicione a conta na lista de usuários de teste da tela de consentimento ou publique o app conforme as regras do Google. |

## Estrutura

```
server.js            API REST, auth e perfil
db.js                adaptador assíncrono: PostgreSQL/Supabase ou SQLite local
database.js          criação do schema e migrações SQLite compatíveis
api/[...path].js     entrada da função Express na Vercel
vercel.json          build, saída estática e roteamento de API
test/                testes automatizados da API e das migrações
client/
  test/              testes de interface com Vitest + React Testing Library
  vitest.config.ts   configuração do Vitest e ambiente jsdom
client/src/
  pages/             Login, Today, Subjects, Tasks, Profile
  pixel.tsx          Sprites, personagem, avatar e cenário
  api.ts, auth.tsx   Cliente da API e contexto de login
  timer.ts           Hook do pomodoro
```

## API

Tudo abaixo de `/api` exige login (cookie), exceto `config` e `auth/*`.

| Método | Rota | Descrição |
|---|---|---|
| GET | /api/config | Configuração pública (ID do Google) |
| POST | /api/auth/register, /login, /google, /logout | Autenticação |
| GET / PUT | /api/me | Perfil: `username`, `character`, `avatarImage`, `avatarMode` |
| GET | /api/all | Matérias, tarefas, projetos e sessões do usuário |
| POST / PUT / DELETE | /api/subjects[/:id] | Matérias e notas em Markdown |
| POST / PATCH / DELETE | /api/tasks[/:id] | Tarefas; PATCH aceita `done` e/ou `project_id` |
| POST / DELETE | /api/projects[/:id] | Projetos; o progresso é calculado pelas tarefas vinculadas |
| POST | /api/sessions | Sessão de foco (`minutes`, `day`) |

## Notas

- Se você usou a versão anterior (sem login), os dados antigos passam a pertencer à primeira conta criada.
- Novas contas começam sem matérias, tarefas ou projetos de exemplo.
- Tarefas podem ser movidas entre projetos pela aba **Tarefas**. O progresso é a porcentagem de tarefas concluídas entre as tarefas vinculadas; projeto sem tarefas fica em 0%.
- `npm test` executa os testes de API/migração com `node:test`, um teste do adaptador/schema PostgreSQL com `pg-mem`, e os testes de interface com Vitest + React Testing Library. A suíte da interface usa um mock local da API e cobre navegação, conta vazia/criação de matéria, autosave de notas, criação/conclusão/movimentação de tarefas e progresso acessível, teclado do perfil e mensagens de erro. Os fluxos de API usam SQLite isolado/em memória e tokens Google simulados. O teste com `pg-mem` não substitui um smoke test contra um projeto Supabase real.
- Os lockfiles são fonte da instalação reproduzível e devem acompanhar alterações nos `package.json`.
- Para publicar, use HTTPS, defina `JWT_SECRET` e `NODE_ENV=production`, e guarde o `estudos.db` em um volume persistente.
