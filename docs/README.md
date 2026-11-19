# Documentação do MotoControl

A documentação está separada por público. Cada pasta é independente.

## [`contexto/`](contexto/01-visao-geral.md) — entender o projeto

Para quem precisa saber **o que é, por que existe e por que foi feito assim**: sócios, novos desenvolvedores, quem vai propor mudanças, assistentes de IA.

1. [Visão geral](contexto/01-visao-geral.md) — problema, solução, público, escopo, critérios de aceitação
2. [Registro de decisões](contexto/02-decisoes.md) — escolhas técnicas e de produto, com motivo e custo
3. [Regras de negócio](contexto/03-regras-de-negocio.md) — cada regra, onde está no código e qual teste a garante
4. [Glossário](contexto/04-glossario.md) — termos da oficina e seus nomes no código
5. [Situação e próximos passos](contexto/05-situacao-e-proximos-passos.md) — pendências, riscos e roadmap
6. [Briefing técnico original (PDF)](contexto/briefing-tecnico-v1.0.pdf)

## [`manual/`](manual/README.md) — usar o sistema

Para **quem trabalha na oficina**. Também aparece dentro do sistema, no botão **Ajuda**, e vai junto no pacote de instalação.

1. [Primeiros passos](manual/01-primeiros-passos.md)
2. [Comandas](manual/02-comandas.md)
3. [Clientes e motocicletas](manual/03-clientes-e-motos.md)
4. [Consultas e histórico](manual/04-consultas-e-historico.md)
5. [Administração](manual/05-administracao.md)
6. [Servidor, backup e atualização](manual/06-servidor-e-backup.md)
7. [Perguntas frequentes](manual/07-perguntas-frequentes.md)

## [`tecnico/`](tecnico/README.md) — desenvolver e manter

Para **quem mexe no código** ou dá suporte técnico.

1. [Arquitetura](tecnico/01-arquitetura.md)
2. [Banco de dados](tecnico/02-banco-de-dados.md)
3. [API REST](tecnico/03-api.md)
4. [Desenvolvimento](tecnico/04-desenvolvimento.md)
5. [Instalação e implantação](tecnico/05-instalacao-e-implantacao.md)

## Mantendo a documentação em dia

| Mudou... | Atualize |
|---|---|
| Algo que o usuário vê ou faz | `manual/` (e as capturas em `manual/imagens/`, se a tela mudou) |
| Uma regra de negócio | `contexto/03-regras-de-negocio.md` e o teste correspondente |
| Uma decisão de arquitetura ou de produto | Nova entrada em `contexto/02-decisoes.md` (não apague as antigas; marque como substituída) |
| Endpoints, tabelas, variáveis do `.env` | `tecnico/` |
| Uma entrega foi feita | `contexto/05-situacao-e-proximos-passos.md` |
