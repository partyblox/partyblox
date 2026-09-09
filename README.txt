PARTYBLOX - VERSAO CORRIGIDA

Estrutura:
  index.html
  server.js
  package.json
  games/checkers.html
  games/chess.html
  games/tictactoe.html

Limites:
  Midia principal (host): 900 MB
  Midia enviada pelo chat: 300 MB

Servidor:
  npm install
  npm start

Correcoes principais:
  - YouTube: removido autoplay global e sincronizacao automatica que podia recarregar o player e reiniciar estados/anuncios.
  - Upload principal aceita ate 900 MB.
  - Chat aceita midia ate 300 MB e usa /upload-chat.
  - Aviso visual "Aguarde o carregamento..." durante uploads.
  - Damas: peao comum nao pode capturar para tras; somente dama captura em qualquer direcao.
  - Xadrez: atribuicao de cores robusta e renderizacao das pecas reforcada.
  - Jogo da Velha: corrigido o bug que preenchia a casa antes de applyMove(), impedindo a troca de turno.
  - Jogos: parent agora envia players com symbol/color para os iframes.
