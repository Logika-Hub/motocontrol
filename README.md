# MotoControl

Sistema web de gerenciamento de **oficinas de motocicletas**. Roda em um computador da oficina e é acessado pelos demais pelo navegador, na rede local, **sem depender de internet**.

O centro do sistema é a **comanda** (ordem de serviço): cada moto que entra recebe uma, e tudo o que acontece com ela — diagnóstico, serviços, peças, mudanças de situação — fica numa linha do tempo com o nome de quem fez e o horário.

![Comanda no MotoControl](docs/manual/imagens/comanda.png)

## Comece por aqui

| Eu quero... | Vá para |
|---|---|
| **Usar o sistema** na oficina | [Manual do usuário](docs/manual/README.md) — também no botão **Ajuda** dentro do sistema |
| **Instalar** em uma oficina | [Servidor, backup e atualização](docs/manual/06-servidor-e-backup.md) |
| **Entender o projeto** (objetivo, escopo, decisões) | [Contexto](docs/contexto/01-visao-geral.md) |
| **Desenvolver ou manter** o código | [Documentação técnica](docs/tecnico/README.md) |

Índice completo: [`docs/`](docs/README.md).

## Início rápido

**Instalar numa oficina (Windows):** gere o pacote no seu computador com `npm run pacote`, copie `dist/MotoControl-<versão>/` para o servidor (ex.: `C:\MotoControl`) e execute **`instalar.bat`** como administrador. Depois, use o atalho **MotoControl** na área de trabalho.

**Rodar em desenvolvimento:**
```bash
npm install
```
```bash
echo "DATABASE_URL=postgres://USUARIO:SENHA@localhost:5432/motocontrol" > .env
```
```bash
npm run seed:demo && npm run dev
```
Acesse `http://localhost:3000` com `carlos` / `demo123` (mecânico) ou `admin` / `admin123`. Detalhes em [Desenvolvimento](docs/tecnico/04-desenvolvimento.md).

## O que tem nesta versão

Login individual com 4 perfis (administrador, atendente, mecânico, consulta) · dashboard · clientes e motocicletas · comandas com status, serviços, peças e linha do tempo imutável · consultas com filtros · histórico de manutenção por moto · impressão da comanda com assinaturas · auditoria · backup automático e restauração · instalador automático e pacote offline · manual integrado.

**Fora do escopo desta versão:** financeiro, estoque, orçamentos, nota fiscal, WhatsApp, multifilial e acesso pela internet. Veja [Situação e próximos passos](docs/contexto/05-situacao-e-proximos-passos.md).

## Organização do repositório

```
instalar.bat / .sh     instala no servidor da oficina
iniciar.bat  / .sh     abre o sistema (inicia o servidor, se preciso)
parar.bat    / .sh     para o servidor
app.js                 ponto de entrada do servidor
server/                back-end (rotas, regras de negócio, permissões)
client/                front-end (telas, estilos)
database/              migrations e dados iniciais
scripts/               instalador, controle, pacote, backup e restauração
tests/                 testes de integração
docs/                  contexto, manual do usuário e documentação técnica
```

Stack: Node.js 20+ · Express · PostgreSQL · JavaScript puro no front-end (sem etapa de build).

## Licença

Software proprietário — todos os direitos reservados. Veja [LICENSE](LICENSE). As bibliotecas de terceiros (em `node_modules`) seguem suas próprias licenças (MIT, ISC e BSD), todas compatíveis com uso comercial.
