PARTYBLOX - VERSÃO CORRIGIDA

Arquivos:
- index.html
- server.js
- package.json
- render.yaml

LOCALHOST:
1. Instale Node.js.
2. Abra o terminal nesta pasta.
3. Rode: npm install
4. Rode: npm start
5. Abra: http://localhost:3000

RENDER:
- Suba esta pasta para seu serviço Node.
- O render.yaml usa npm install e npm start.

CORREÇÕES:
- Link do YouTube com watch, youtu.be, shorts, embed e live.
- YouTube sincronizado pela sala.
- Upload de imagem, vídeo e áudio pelo servidor, sem mandar base64 pelo WebSocket.
- Compartilhamento de tela por WebRTC entre host e participantes.
- Sinalização WebRTC pelo WebSocket.
- Reconexão e entrada de novos participantes durante o compartilhamento.
- Limpar tela encerra corretamente a transmissão.

OBSERVAÇÃO:
- Alguns vídeos do YouTube não permitem incorporação; nesses casos o próprio YouTube bloqueia o player.
- Navegadores podem exigir um clique do participante para liberar áudio automático.
- Compartilhamento de tela precisa de HTTPS em produção; localhost é permitido pelos navegadores.
