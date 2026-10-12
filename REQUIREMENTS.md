# Requisitos do Diário de Estudos

## Execução e desenvolvimento

- Node.js 20.12 ou superior.
- Manter o suporte a Node.js 20.12+ ao atualizar dependências, salvo decisão explícita de alterar a versão mínima.
- Instalação reproduzível das dependências com `npm ci` na raiz e em `client/`.
- As dependências diretas e transitivas devem ser verificadas com `npm audit` na raiz e no cliente; alterações de manifests devem atualizar os lockfiles correspondentes.
- Build do frontend validado com TypeScript estrito e Vite por `npm run build` em `client/`.
- Testes automatizados executados com `npm test` na raiz, usando `node:test` e SQLite isolado/em memória.
- O aplicativo deve continuar usando SQLite local sem exigir serviços externos. Google OAuth é opcional e depende de `GOOGLE_CLIENT_ID`.
- Em produção na Vercel, o banco deve ser PostgreSQL configurado por `DATABASE_URL`; não depender de armazenamento local efêmero. A conexão SQLite continua disponível para desenvolvimento e testes.
- Login Google deve validar no servidor o ID token emitido para o client ID configurado, exigir `sub` e e-mail verificado, e vincular e-mails já cadastrados sem criar uma segunda conta.
- Testes automatizados da rota Google devem simular a validação de tokens; a validação ponta a ponta usa client ID e contas de teste configuradas no Google Cloud.

## Contas e dados iniciais

- Uma conta nova deve iniciar sem matérias, tarefas ou projetos de exemplo.
- Os dados pertencem ao usuário autenticado; tentativas de associar tarefas a projetos ou matérias de outra conta não podem expor nem alterar dados dessa conta.
- Migrações devem preservar os dados existentes e permitir que versões anteriores do banco continuem abrindo.

## Tarefas e projetos

- Uma tarefa pode ficar sem projeto ou ser vinculada a um projeto do próprio usuário.
- Uma tarefa existente pode ser movida para outro projeto ou desvinculada pela interface.
- O progresso do projeto é calculado como `tarefas concluídas / total de tarefas vinculadas`, em porcentagem inteira arredondada.
- Criar tarefa pendente, concluir, reabrir, mover ou excluir uma tarefa deve manter atualizados todos os projetos afetados.
- Um projeto sem tarefas deve mostrar progresso de 0%.
- O progresso é somente derivado das tarefas; não deve haver controle manual que o sobrescreva.
- A interface deve apresentar o progresso em uma barra acessível, além do valor percentual.

## Interface e idioma

- Textos e mensagens para o usuário devem permanecer em português do Brasil.
- A apresentação deve seguir o visual leve e acolhedor já adotado pelo projeto e continuar utilizável em telas estreitas.
