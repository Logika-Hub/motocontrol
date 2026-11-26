# Situação atual e próximos passos

*Atualize este arquivo a cada entrega.*

## Situação (v0.1.0)

O escopo obrigatório do MVP (briefing, seção 10.1) está implementado e coberto por testes de integração. O projeto **ainda não foi usado em uma oficina real**.

## Antes da primeira oficina

| Prioridade | Item | Por quê |
|---|---|---|
| 🔴 Alta | **Testar o pacote completo em um Windows 10/11 limpo, sem internet** (máquina virtual serve) | `instalar.bat`, caixa de senha do PowerShell, instalação silenciosa do PostgreSQL, tarefa agendada, firewall, atalhos e `parar.bat` nunca foram executados em Windows real |
| 🔴 Alta | Rodar `node scripts\control.js rede` nesse mesmo Windows | Os ramos Windows do comando (`netsh`, `Get-NetConnectionProfile`, `net session`) só foram testados em Linux; os ramos Linux e a lógica de servidor/bind foram verificados |
| 🔴 Alta | Conferir o instalador do PostgreSQL no pacote (`PG_DEFAULT_URL` em `scripts/gerar-pacote.js`) e atualizar para a versão 17.x mais recente | O download não pôde ser testado no ambiente de desenvolvimento |
| 🔴 Alta | Combinar com a oficina **quem copia os backups para mídia externa e com que frequência** | Backups ficam no mesmo disco do servidor |
| 🟡 Média | Contrato de licença de uso (prazo, suporte, responsabilidade, LGPD) | O sistema guarda CPF, telefone e endereço de clientes |
| 🟡 Média | Validar a matriz de permissões com a oficina ([D11](02-decisoes.md#d11--matriz-de-permissões-no-back-end-em-um-único-arquivo)) | Algumas permissões são suposições |
| 🟢 Baixa | Teste piloto de 1–2 semanas acompanhando o uso | Ajustar fluxo real antes de ampliar |

## Candidatos à próxima versão (v1.1)

Pequenos, alinhados ao briefing e de alto valor:

- **Dados da oficina** (nome, CNPJ, endereço, telefone, logo) no cabeçalho da comanda impressa.
- **Reabrir comanda** (só admin, com justificativa e registro no histórico).
- **Aviso de backup não copiado**: lembrete no Dashboard do admin se a última cópia externa tiver mais de 7 dias.
- **Busca global** na barra superior (placa, nome ou número da OS).

## Expansões previstas no briefing (seção 12) — fora do MVP

Controle de estoque e peças · fornecedores · emissão de documentos · envio de atualizações ao cliente · relatórios de produtividade · hospedagem em nuvem com acesso remoto.

> Antes de começar qualquer uma, valide com a oficina o fluxo atual (comandas + histórico) em uso real — é a diretriz principal do briefing.

## Riscos conhecidos

| Risco | Mitigação atual |
|---|---|
| Disco do servidor falha | Backup diário + orientação de cópia externa (manual e tela de admin). Depende de disciplina da oficina |
| Servidor desligado/suspenso | Instalador desativa suspensão; sistema inicia com o Windows |
| IP do servidor muda | Instrução para reservar IP no roteador; reexecutar o instalador regenera o atalho |
| Único administrador perde a senha | Manual recomenda dois administradores; recuperação técnica via banco |
| Sessões HTTP sem TLS na rede local | Rede interna; cookies `httpOnly` e `sameSite=strict`. HTTPS seria necessário antes de qualquer acesso pela internet |

## Financeiro (D19) — situação

Implementado: fechamento de venda, comissões, repasses, painel individual e geral, histórico de vendas. Verificado com os testes automatizados e no navegador em ambiente local com substitutos de pacote; **ainda não executado com `npm test` real nem no Windows**. Antes de usar com dinheiro real: rodar `npm test`, validar com a oficina as regras de comissão e o fluxo de estorno.
