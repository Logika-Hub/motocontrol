# MotoControl

Sistema web de gerenciamento de oficinas de motocicletas — **v1.0 (MVP)**, executado em servidor local na rede LAN da oficina.

A comanda (ordem de serviço) é o elemento central: recebimento da moto, diagnóstico, serviços, peças, status e histórico de atividades com identificação do funcionário e horário gerado pelo servidor.

## Escopo do MVP
- Autenticação individual e perfis (Administrador, Atendente, Mecânico, Consulta), com permissões verificadas no back-end
- Dashboard operacional
- Cadastro de clientes e motocicletas
- Comandas (`OS-000001`, sequencial) com status: Aberta → Em diagnóstico → Aguardando peças → Em execução → Concluída / Cancelada
- Linha do tempo de atividades por comanda e auditoria
- Consulta de comandas e histórico de manutenção por motocicleta
- Backup e restauração do banco

**Fora do escopo:** financeiro, estoque, compras, orçamentos, notas fiscais, WhatsApp, multifilial, acesso pela internet.

## Stack
Node.js + Express · PostgreSQL · API REST · HTML/CSS/JS no front-end.

## Estrutura
```
client/    pages, components, styles, scripts
server/    config, controllers, middlewares, models, routes, services
database/  migrations, seeds
backups/   (ignorado pelo Git)
docs/      briefing técnico
```

## Documentação
- [Briefing técnico v1.0](docs/MotoControl_Briefing_Tecnico_v1.0.pdf)

## Configuração
Copie `.env.example` para `.env` e ajuste os valores.
