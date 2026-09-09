PARTYBLOX - VERSAO 2.1 CORRIGIDA

CORRECOES DESTA VERSAO:
- Quem entra depois que a mídia já começou recebe o estado atual de YouTube, vídeo, áudio e imagem.
- YouTube não é recarregado desnecessariamente quando chega uma atualização do mesmo vídeo, evitando reinícios.
- Vídeos e áudios tentam iniciar no ponto atual; se o navegador bloquear autoplay com som, aparece um botão "Assistir/Ativar áudio".
- Imagens são carregadas novamente para novos participantes.
- Compartilhamento de tela agora usa WebRTC entre o host que compartilha e cada novo participante, com ICE/STUN e negociação offer/answer/candidate.
- Se alguém entrar durante o compartilhamento de tela, o servidor solicita automaticamente ao host uma nova conexão WebRTC.
- Novo botão "🪟 Flutuante" no topo.
- Tela flutuante fica sobre o chat, pode ser arrastada pelo puxador superior e redimensionada pelo canto inferior direito.
- O usuário pode continuar usando chat, reações, temas e jogos enquanto a mídia fica em uma janela flutuante.

LIMITES:
- Mídia principal: 900 MB.
- Mídia do chat: 300 MB.

ESTRUTURA:
index.html
server.js
package.json
games/checkers.html
games/chess.html
games/tictactoe.html

EXECUCAO:
npm install
npm start

OBSERVACAO:
- Navegadores podem bloquear reprodução automática de áudio por política de autoplay. Nesse caso, use o botão exibido sobre a mídia para ativar o som.
- Compartilhamento de tela usa conexão WebRTC direta entre participantes. STUN está configurado; redes muito restritivas podem exigir TURN.
