PARTYBLOX — SITE FINAL

Esta versão é SOMENTE o site normal do PartyBlox:
- Sem mundo 3D.
- Sem avatares.
- Sem editor de avatar.
- Sem WorldModel.

RECURSOS:
- Salas multiplayer por WebSocket.
- Chat público.
- Mensagem privada com @nome.
- Emojis.
- Reações.
- Emotes.
- Envio de imagem e vídeo no chat.
- Gravação e envio de áudio no chat (até 30s).
- YouTube sincronizado pelo host.
- Upload de vídeo, imagem e áudio para o telão.
- Controles sincronizados de vídeo/áudio.
- Compartilhamento de tela ao vivo por WebRTC.
- Entrada de novos participantes durante a transmissão.
- Limpar tela encerra mídia e conexões WebRTC.
- Host automático quando o host sai.
- Localhost e Render.

LOCALHOST:
1. Instale Node.js.
2. Abra o terminal na pasta.
3. npm install
4. npm start
5. Abra http://localhost:3000

RENDER:
- Faça upload/conecte esta pasta ao serviço Node.
- Build: npm install
- Start: npm start

OBSERVAÇÕES:
- Compartilhamento de tela exige HTTPS em produção; localhost é aceito pelo navegador.
- O áudio da tela pode depender do navegador e da opção "compartilhar áudio" escolhida.
- Alguns vídeos do YouTube não permitem incorporação.


CORREÇÃO DE HOST + CONTROLES
- Quem cria uma sala é marcado como host e essa informação é mantida para a sala criada.
- WebSocket funciona automaticamente em localhost e Render.
- Host possui botão para ocultar/mostrar os controles de compartilhamento.
