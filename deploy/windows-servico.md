# Iniciar o MotoControl automaticamente no Windows

O PostgreSQL instalado pelo instalador oficial já roda como serviço do Windows. Para o MotoControl, a forma mais simples
é registrá-lo como serviço com o [NSSM](https://nssm.cc/):

1. Baixe o NSSM e extraia `nssm.exe` (pasta `win64`) para `C:\nssm\`.
2. Abra o **Prompt de Comando como administrador** e execute (ajuste os caminhos):

```bat
C:\nssm\nssm.exe install MotoControl "C:\Program Files\nodejs\node.exe" "C:\motocontrol\app.js"
C:\nssm\nssm.exe set MotoControl AppDirectory "C:\motocontrol"
C:\nssm\nssm.exe set MotoControl DependOnService postgresql-x64-16
C:\nssm\nssm.exe set MotoControl AppStdout "C:\motocontrol\motocontrol.log"
C:\nssm\nssm.exe set MotoControl AppStderr "C:\motocontrol\motocontrol.log"
C:\nssm\nssm.exe start MotoControl
```

3. Libere a porta no firewall para os outros computadores da oficina:

```bat
netsh advfirewall firewall add rule name="MotoControl" dir=in action=allow protocol=TCP localport=3000 profile=private
```

4. Configure o Windows para **não suspender** este computador (Configurações → Sistema → Energia).

Para parar/reiniciar: `C:\nssm\nssm.exe restart MotoControl` ou pelo painel *Serviços* (`services.msc`).
