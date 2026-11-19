# Servidor, backup e atualização

*Para quem cuida do computador onde o MotoControl está instalado.*

O MotoControl roda em **um computador da oficina (o servidor)**. Os outros computadores apenas acessam pelo navegador. Por isso:

- o servidor **precisa estar ligado** para todos usarem o sistema;
- ele **não deve entrar em suspensão** (o instalador oferece desativar isso);
- todos os dados e backups ficam **no disco dele**.

## Instalar

Feito uma única vez, por quem entende um pouco de computador:

1. Copie a pasta do MotoControl para o disco do servidor — por exemplo, `C:\MotoControl`. **Não** rode do pendrive.
2. Clique com o botão direito em **`instalar.bat`** → **Executar como administrador**.
3. Se o PostgreSQL (banco de dados) ainda não estiver instalado, o instalador pede para você **definir a senha do banco**. Ela não é usada no dia a dia, mas é necessária para reinstalar ou dar manutenção — **anote-a em local seguro**, pois ela não fica salva no computador. (Mínimo de 8 caracteres, sem espaços nem os símbolos `" ' ^ % ! & | < >`.)
   Se o PostgreSQL já estiver instalado, o instalador pede a senha que foi definida quando ele foi instalado.
4. Defina a senha do usuário **admin** do MotoControl quando for pedido.
5. No final, anote o **endereço para os outros computadores** que aparece na tela (ex.: `http://192.168.0.100:3000`).
6. Copie o arquivo **`MotoControl (outros computadores).url`**, criado na pasta do sistema, para a área de trabalho de cada computador da oficina.

O instalador instala o que for preciso (Node.js e banco de dados PostgreSQL), cria o banco, configura o sistema para iniciar sozinho com o Windows, libera o acesso no firewall e cria o atalho **MotoControl** na área de trabalho.

> **Endereço fixo:** peça a quem configurou a internet da oficina para **reservar o IP do servidor** no roteador. Sem isso, o endereço pode mudar e os atalhos dos outros computadores param de funcionar.

> **Guarde juntas** a senha do banco (PostgreSQL) e a senha do admin do MotoControl, em local seguro fora do computador (cofre de senhas, envelope lacrado).

Em Linux, use `sudo ./instalar.sh`.

## Ligar, desligar e abrir

| Para... | Faça |
|---|---|
| Abrir o sistema | Atalho **MotoControl** na área de trabalho (ou `iniciar.bat`). Se o sistema estiver parado, ele é iniciado antes |
| Parar o sistema | `parar.bat` (pede permissão de administrador). Os outros computadores perdem o acesso |
| Ligar depois de desligar o computador | Nada — o sistema inicia sozinho junto com o Windows |

## Backup

- **Automático:** todo dia, guardando os 30 mais recentes na pasta `backups`.
- **Manual:** botão **Gerar backup agora** em *Administração*.
- **Cópia externa (sua responsabilidade):** toda semana, copie a pasta `backups` para um pendrive ou HD externo.

## Restaurar um backup

Restaurar **substitui todos os dados atuais** pelos do backup. Use só em caso de perda de dados ou troca de computador.

1. Rode **`parar.bat`**.
2. Abra o **Prompt de Comando** na pasta do MotoControl (na barra de endereço da pasta, digite `cmd` e Enter).
3. Veja os backups disponíveis:
   ```
   npm run restore -- --list
   ```
4. Restaure o escolhido (copie o nome exato):
   ```
   npm run restore -- motocontrol-20261119-020000.dump
   ```
   Digite `RESTAURAR` para confirmar. Antes de restaurar, o sistema guarda um backup do estado atual, por segurança.
5. Rode **`iniciar.bat`**.

## Trocar o servidor de computador

1. No computador antigo: gere um backup em *Administração* e copie o arquivo `.dump` mais recente.
2. No novo: instale o MotoControl normalmente (veja [Instalar](#instalar)).
3. Coloque o arquivo `.dump` na pasta `backups` do novo computador e siga [Restaurar um backup](#restaurar-um-backup).
4. Atualize o atalho dos outros computadores com o novo endereço.

## Atualizar para uma nova versão

1. Gere um backup em *Administração* e rode **`parar.bat`**.
2. Copie os arquivos da nova versão **por cima** da pasta atual. **Não apague** os arquivos `.env` (configuração) e a pasta `backups`.
3. Rode **`instalar.bat`** como administrador. Ele mantém os dados e a configuração e atualiza o banco automaticamente.

## Esqueci a senha do PostgreSQL

*Para quem tem familiaridade com o computador.* No dia a dia essa senha não é usada — o MotoControl tem a própria senha de acesso ao banco, no arquivo `.env`. Ela só é pedida quando o instalador precisa criar o banco de novo (por exemplo, numa reinstalação em que o `.env` foi perdido). Para definir uma senha nova:

1. Rode **`parar.bat`**.
2. Abra o Bloco de Notas **como administrador** e abra o arquivo `C:\Program Files\PostgreSQL\17\data\pg_hba.conf` (o número pode ser outro, conforme a versão).
3. Nas linhas que começam com `host` e contêm `127.0.0.1/32` e `::1/128`, troque `scram-sha-256` por `trust` e salve.
4. Em **Serviços** (`services.msc`), reinicie o serviço **postgresql**.
5. Abra o Prompt de Comando e execute (troque `NovaSenha123` pela senha nova):
   ```
   "C:\Program Files\PostgreSQL\17\bin\psql" -U postgres -h 127.0.0.1 -c "ALTER USER postgres PASSWORD 'NovaSenha123'"
   ```
6. **Volte** as linhas do passo 3 para `scram-sha-256`, salve e reinicie o serviço **postgresql** de novo. Não pule este passo: com `trust`, qualquer programa do computador acessa o banco sem senha.
7. Rode o instalador ou **`iniciar.bat`** normalmente.

## Problemas no servidor

| Sintoma | O que fazer |
|---|---|
| Ninguém consegue acessar | Verifique se o servidor está ligado. Rode `iniciar.bat` no servidor e veja a mensagem |
| Só os outros computadores não acessam | Confira o endereço (IP) do servidor e se estão na mesma rede. O endereço está no arquivo `MotoControl (outros computadores).url`, na pasta do sistema (abra com o Bloco de Notas). Se o IP do servidor mudou, rode `instalar.bat` de novo para gerar o atalho atualizado |
| `iniciar.bat` diz que o sistema não respondeu | Abra o arquivo `motocontrol.log`, na pasta do sistema, e envie as últimas linhas ao suporte |
| "PostgreSQL não está aceitando conexões" | Abra **Serviços** do Windows (`services.msc`) e inicie o serviço **postgresql** |

---

Anterior: [Administração](05-administracao.md) · Próximo: [Perguntas frequentes](07-perguntas-frequentes.md)
