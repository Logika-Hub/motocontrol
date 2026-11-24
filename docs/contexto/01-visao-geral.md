# Visão geral do projeto

> Contexto para quem chega ao projeto — desenvolvedor, sócio, cliente ou assistente de IA. Fonte original dos requisitos: [briefing técnico v1.0](briefing-tecnico-v1.0.pdf).

## O problema

Oficinas de motocicletas pequenas e médias controlam a entrada de motos com **papel, cadernos e mensagens**. Isso causa:

- perda de informação (o que foi feito, quando, por quem);
- dificuldade de responder ao cliente "em que pé está a minha moto?";
- nenhum histórico consultável por veículo ("quando foi a última troca de corrente?");
- nenhuma responsabilização: não se sabe qual mecânico fez cada serviço.

## A solução

O **MotoControl** é um sistema web que roda **dentro da oficina**: um computador funciona como servidor e os demais acessam pelo navegador, na rede local, sem depender de internet.

O centro de tudo é a **comanda** (ordem de serviço). Cada entrada de moto gera uma comanda com número sequencial, e tudo que acontece com ela fica numa **linha do tempo imutável** — cada registro com o funcionário autenticado e o horário do servidor.

## Público

| Quem | Usa para |
|---|---|
| Atendente | Receber o cliente, cadastrar cliente/moto, abrir comandas, atualizar previsão |
| Mecânico | Registrar diagnóstico, serviços, peças e andamento |
| Dono / gerente (administrador) | Acompanhar a operação, gerenciar funcionários, auditoria e backups |
| Consulta | Visualizar sem alterar (ex.: sócio, contador) |

## Escopo da versão 1.0 (MVP)

**Dentro:** autenticação e perfis; dashboard; clientes; motocicletas; comandas com status, serviços, peças e linha do tempo; consulta com filtros; histórico por moto; auditoria; backup e restauração; instalação automática; impressão da comanda; **financeiro (D19, adicionado depois do MVP):** fechamento de venda, comissões, repasses e dashboards de desempenho.

**Fora (por decisão do briefing):** estoque, compras e fornecedores, orçamento com aprovação digital, nota fiscal, WhatsApp, múltiplas filiais e acesso pela internet.

> Diretriz do briefing: *"desenvolver primeiro um sistema funcional de gerenciamento de comandas e histórico de manutenção, evitando implementar módulos financeiros ou administrativos que não fazem parte da necessidade inicial."*

## Critérios de aceitação do briefing — situação

| Critério | Situação | Como foi verificado |
|---|---|---|
| Administrador acessa e cadastra funcionários | ✅ | Teste automatizado |
| Funcionários acessam com contas individuais | ✅ | Teste automatizado |
| Cadastro de clientes e motocicletas | ✅ | Teste automatizado |
| Comanda criada e vinculada a cliente e moto | ✅ | Teste automatizado |
| Mecânicos diferentes registram na mesma comanda | ✅ | Teste automatizado |
| Cada atividade mostra funcionário e horário corretos | ✅ | Teste automatizado (autor/horário não podem ser forjados) |
| Status pode ser atualizado | ✅ | Teste automatizado |
| Alterações relevantes ficam registradas | ✅ | Teste automatizado (histórico + auditoria) |
| Histórico da moto consultável | ✅ | Teste automatizado |
| Uso simultâneo em computadores diferentes | ✅ | Testes de concorrência (numeração e edição) |
| Dados persistem após reiniciar o servidor | ✅ | PostgreSQL + sessões no banco |
| Backup gerado e restaurado | ✅ | Teste automatizado |

Pendências e riscos conhecidos: veja [Situação atual e próximos passos](05-situacao-e-proximos-passos.md).

## Mapa da documentação

| Pasta | Para quem | Conteúdo |
|---|---|---|
| [`docs/contexto/`](./) | Todos que precisam entender o projeto | Este documento, decisões, regras de negócio, glossário, próximos passos |
| [`docs/manual/`](../manual/README.md) | Quem usa o sistema na oficina | Manual do usuário (também em `/ajuda` dentro do sistema) |
| [`docs/tecnico/`](../tecnico/README.md) | Quem desenvolve e mantém | Arquitetura, banco, API, desenvolvimento, implantação |
