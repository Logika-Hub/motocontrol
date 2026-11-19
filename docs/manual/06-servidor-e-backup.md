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
3. Defina a senha do usuário **admin** quando for pedido.
4. No final, anote o **endereço para os outros computadores** que aparece na tela (ex.: `http://192.168.0.100:3000`).
5. Copie o arquivo **`MotoControl (outros computadores).url`**, criado na pasta do sistema, para a área de trabalho de cada computador da oficina.

O instalador instala o que for preciso (Node.js e banco de dados PostgreSQL), cria o banco, configura o sistema para iniciar sozinho com o Windows, libera o acesso no firewall e cria o atalho **MotoControl** na área de trabalho.

> **Endereço fixo:** peça a quem configurou a internet da oficina para **reservar o IP do servidor** no roteador. Sem isso, o endereço pode mudar e os atalhos dos outros computadores param de funcionar.

> Se o instalador precisar instalar o PostgreSQL, ele cria o arquivo `postgres-superusuario.txt` com a senha do banco. Guarde essa senha em local seguro (junto com a senha do admin) e **apague o arquivo**.

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

## Problemas no servidor

| Sintoma | O que fazer |
|---|---|
| Ninguém consegue acessar | Verifique se o servidor está ligado. Rode `iniciar.bat` no servidor e veja a mensagem |
| Só os outros computadores não acessam | Confira o endereço (IP) do servidor e se estão na mesma rede. O endereço está no arquivo `MotoControl (outros computadores).url`, na pasta do sistema (abra com o Bloco de Notas). Se o IP do servidor mudou, rode `instalar.bat` de novo para gerar o atalho atualizado |
| `iniciar.bat` diz que o sistema não respondeu | Abra o arquivo `motocontrol.log`, na pasta do sistema, e envie as últimas linhas ao suporte |
| "PostgreSQL não está aceitando conexões" | Abra **Serviços** do Windows (`services.msc`) e inicie o serviço **postgresql** |

---

Anterior: [Administração](05-administracao.md) · Próximo: [Perguntas frequentes](07-perguntas-frequentes.md)
