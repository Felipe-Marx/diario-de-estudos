# Diário de Estudos

Workspace de estudos com login, perfil personalizável (personagem pixelado ou imagem) e visual inspirado em Stardew Valley.

- **Backend:** Node 20.12+ + Express + SQLite (`better-sqlite3`), autenticação com JWT em cookie httpOnly, senhas com bcrypt
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
| `DB_PATH` | Caminho alternativo do SQLite; usado pelos testes para apontar a um banco temporário |

### Login com Google

1. Acesse o [Google Cloud Console](https://console.cloud.google.com/) e crie um projeto.
2. Configure a tela de consentimento OAuth e adicione as contas de teste enquanto o app estiver em modo de testes.
3. Em **APIs e serviços → Credenciais**, crie um **ID do cliente OAuth** do tipo **Aplicativo da Web**.
4. Em **Origens JavaScript autorizadas**, adicione a origem que abre a interface: `http://localhost:3000` quando servido pelo Express ou `http://localhost:5173` no desenvolvimento Vite (e o domínio HTTPS quando publicar).
5. Copie o ID do cliente para `GOOGLE_CLIENT_ID` no `.env` do servidor e reinicie o servidor. O ID é público e enviado ao navegador por `/api/config`; nunca coloque segredo OAuth no frontend.

O app recebe a credencial do Google Identity Services e valida o ID token no backend usando o mesmo `GOOGLE_CLIENT_ID` como audience. Apenas tokens com `sub` e e-mail verificado são aceitos. Uma conta Google com e-mail já cadastrado vincula-se à conta existente; logins posteriores identificam a conta pelo `sub`.

Para validar localmente, confirme que `/api/config` retorna o client ID, abra a interface em uma das origens autorizadas no Console e complete o fluxo com uma conta autorizada na tela de consentimento. `npm test` cobre o contrato do backend com tokens simulados; o teste real com Google exige client ID configurado, navegador com acesso à internet e conta autorizada.

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
database.js          criação do schema e migrações SQLite compatíveis
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
- `npm test` executa os testes de API/migração com `node:test` e os testes de interface com Vitest + React Testing Library. A suíte da interface usa um mock local da API e cobre navegação, conta vazia/criação de matéria, autosave de notas, criação/conclusão/movimentação de tarefas e progresso acessível, teclado do perfil e mensagens de erro. Os fluxos de API usam bancos SQLite isolados/em memória e tokens Google simulados.
- Os lockfiles são fonte da instalação reproduzível e devem acompanhar alterações nos `package.json`.
- Para publicar, use HTTPS, defina `JWT_SECRET` e `NODE_ENV=production`, e guarde o `estudos.db` em um volume persistente.
