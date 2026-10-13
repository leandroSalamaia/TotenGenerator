# Totem Studio

Aplicativo local para preparar imagens para totens: usa a transparência original ou remove o fundo branco, suaviza a silhueta, cria um contorno preto ou em degradê e exporta um PNG transparente.

## Abrir

No Windows, dê dois cliques em **Iniciar.bat**. Também pode abrir **index.html** no Chrome ou Edge. Não precisa instalar nada e funciona sem internet; suas imagens ficam no computador.

Como alternativa, com Node.js instalado, execute `npm start` e abra http://127.0.0.1:4173.

## Usar

1. Carregue um PNG, JPG ou WEBP sobre fundo branco ou já transparente. Há uma raposa de exemplo para experimentar. **Origem do recorte → Automático** detecta a transparência conectada à borda e preserva os brancos da arte, como neve, olhos e roupas, inclusive quando encostam no contorno. Sem fundo transparente, remove o branco conectado à borda. É possível escolher explicitamente **Transparência — preservar brancos** ou **Remover fundo branco**.
2. Ajuste a remoção do branco (disponível no modo de fundo branco) e a suavização. A limpeza de pontos é opcional e pode apagar pequenos detalhes separados. O controle de espaços internos abre os espaços maiores e preserva os menores que o limite configurado, inicialmente **2 mm**. No modo de transparência, considera apenas furos realmente transparentes; o branco opaco continua sendo arte. No modo de fundo branco, considera também regiões brancas internas. Desmarque para manter os furos fechados; use **0 mm** para recortar todos os espaços elegíveis.
3. Escolha a espessura em milímetros e o degradê. O padrão começa cinza junto ao desenho e fica preto na borda externa. Em **Ajustes do degradê**, use **Profundidade do preto** para aumentar a faixa escura, **Intensidade do preto** para tornar o tom escuro mais leve ou mais forte, **Tom claro** para escolher a luminosidade do cinza e **Transição** para escolher uma passagem suave, linear ou mais marcada. A faixa de exemplo acompanha os ajustes. **Restaurar** retorna esses quatro controles ao padrão. Os ajustes ficam desabilitados com preto uniforme ou sem contorno. O contorno possui preenchimento opaco; apenas o limite tem antialiasing de um pixel. Esses controles alteram a cor do contorno, mantendo o tamanho e a silhueta de corte.
4. Confira **Silhueta de corte**, inclusive as aberturas internas. **União das bordas**, inicialmente em **2 mm**, fecha frestas estreitas entre os contornos já expandidos. O controle usa o tamanho final em milímetros; aumentar o valor une partes próximas e fecha mais reentrâncias, enquanto aberturas maiores permanecem. Use **0 mm** para desativar a união extra. O limite de espaços internos é verificado também no contorno final, evitando pequenos furos que aparecem apenas depois da expansão da borda. As uniões usam o tom do limite externo do acabamento e preservam a arte opaca, sem criar preenchimentos brancos. O PNG e a silhueta de corte recebem a mesma união, antes de gerar a cópia espelhada.
5. Defina a altura total do arquivo em centímetros e a resolução. Baixe o PNG. Para obter a frente e o verso, marque **Incluir cópia espelhada** junto ao botão de download. **Baixar 2 PNGs** entrega um ZIP com `nome-totem.png` e `nome-totem-espelhado.png`. Extraia o ZIP para usar as duas imagens. A cópia inverte esquerda e direita, mantendo tamanho, transparência, resolução e acabamento da imagem processada. Textos na arte também ficam espelhados.
6. No Cricut Design Space, importe o PNG e escolha **Print Then Cut / Imprimir e Cortar**. Confira o tamanho e a prévia antes da impressão. O aplicativo grava a resolução no campo pHYs do PNG, mas a interpretação do tamanho depende do programa de importação.

Guia oficial: [Como carregar imagens no Design Space](https://help.cricut.com/hc/en-us/articles/360009556313-How-to-upload-images-into-Design-Space).

## Correções manuais, pontes, base e presets

- **Preservar** abre a aba Original. Pinte sobre o detalhe branco ou colorido que deseja recuperar; o pincel restaura os pixels da imagem, inclusive branco que foi confundido com o fundo. Ajuste o diâmetro em pixels da imagem de análise. Verde marca os traços na Original; confira a arte real em Resultado. O pincel não inventa cor em pixels originalmente transparentes.
- **Apagar** remove a área pintada do PNG e da silhueta. Vermelho marca a área na Original. O apagamento continua valendo depois da suavização, do contorno e da união automática, inclusive em furos menores que o limite interno. Um traço posterior de Preservar pode restaurar os pixels originais.
- **Ponte** cria uma ligação reta: ajuste a largura entre **0,5 e 10 mm** e arraste de uma parte a outra, começando e terminando dentro das partes. A ligação tem preenchimento preto, recebe o contorno escolhido e mantém a largura física ao mudar a resolução. As cores das partes atravessadas permanecem. Azul marca a ponte na Original; confira a continuidade na Silhueta de corte.
- **Desfazer / Refazer** e **Ctrl+Z / Ctrl+Shift+Z** controlam as edições manuais. **Limpar edições** também pode ser desfeito; **Esc** cancela um traço em andamento. Há até **200 traços por imagem** e **100 passos de histórico**. Carregar outra imagem reinicia os traços; trocar acabamento, tamanho ou resolução os mantém. As marcações coloridas não são exportadas.
- **Adicionar base** cria uma base arredondada ou retangular, com largura de **10 a 250 mm**, altura de **2 a 40 mm** e cor escolhida. As medidas são do preenchimento, antes do contorno. A base se liga automaticamente à parte inferior da figura e entra na altura total do PNG: a figura diminui para caber junto dela. O PNG mantém a margem transparente e as medidas de exportação.
- **Presets de acabamento** oferece modelos de contorno suave, preto firme e totem com base. Dê um nome e clique em **Salvar** para guardar as configurações atuais; escolha um preset e clique em **Aplicar** para reutilizá-lo. Salvar com o mesmo nome atualiza o preset. **Excluir** remove um preset pessoal. Eles incluem recorte automático, acabamento, base, altura, resolução e opção de espelho, mantendo os traços da arte atual ao aplicar. São até **30 presets**, salvos apenas neste navegador; os traços e arquivos das imagens não fazem parte deles.

Pincel, pontes e base são aplicados ao resultado antes da exportação: o PNG e a cópia espelhada recebem todas as edições. Confira sempre a Silhueta de corte após editar.

## Efeitos foil

Em **Efeitos foil**, escolha **Brilho mágico**, **Estrelas**, **Raios de energia**, **Círculo arcano**, **Aura luminosa** ou **Espiral de magia**. Clique na arte para colocar o efeito, por exemplo na ponta do cajado de um mago. Arraste para mover; selecione um efeito na imagem ou na lista para editar. **Esc** cancela a colocação ou o movimento em andamento.

Ajuste o tamanho entre **4 e 60 mm**, a rotação e a espessura do traço entre **0,1 e 1,5 mm**. Escolha ouro, prata, cobre ou uma cor personalizada. Há opções para duplicar, remover e limpar, com histórico próprio de desfazer/refazer. As abas **Arte + foil** e **Só foil** mostram a composição e a camada isolada. As marcações de seleção não são exportadas.

Quando houver pelo menos um efeito, **Baixar 4 PNGs** entrega um ZIP com:

1. `nome-totem.png`: arte processada, sem foil.
2. `nome-totem-espelhado.png`: espelho horizontal da arte, sem foil.
3. `nome-foil.png`: somente os efeitos sobre fundo transparente; por padrão em preto, com opção de usar as cores escolhidas na prévia.
4. `nome-totem-com-foil.png`: arte com os efeitos nas cores escolhidas.

Todos recebem as mesmas dimensões, resolução e posição da camada de arte; a cópia espelhada inverte o primeiro PNG inteiro. Quando um efeito ultrapassa a área original, os quatro arquivos ganham a mesma margem transparente para evitar cortes. Essa margem pode aumentar a altura final do arquivo acima do valor configurado, mantendo a escala da arte; confira as medidas indicadas junto ao download. A silhueta de corte mostra o recorte da arte, enquanto os efeitos ficam na camada de foil.

Os efeitos mantêm a posição relativa à imagem ao trocar resolução, tamanho, base ou acabamento, e mantêm o tamanho físico escolhido em milímetros. São até **40 efeitos** e **100 passos de histórico**. Carregar outra imagem limpa o foil. Os efeitos não fazem parte dos presets de acabamento; aplicar um preset mantém os efeitos atuais. Sem foil, o download volta às opções de um PNG ou do par original/espelhado.

## Limites e acabamento

- Arquivos de até 30 MB. Imagens acima de 80 megapixels são recusadas; a análise usa até 1800 pixels no maior lado para limitar o uso de memória. O tamanho de exportação é calculado separadamente.
- O PNG tem até 4096 pixels por lado e 12 megapixels. Reduza a altura ou a resolução se exceder esses limites.
- A altura inclui o contorno e uma pequena margem transparente de segurança. As cores da prévia de fundo não são exportadas.
- O limite dos espaços internos usa milímetros no tamanho final de exportação. Ele considera o diâmetro estimado do maior círculo que cabe na abertura, descontando o contorno, e confere novamente após a suavização. Uma fresta comprida e estreita pode ser preservada mesmo com grande área. A estimativa tem a precisão da grade de pixels do PNG.
- No modo de transparência, brancos opacos são preservados mesmo com a remoção interna habilitada. No modo de fundo branco, o programa não consegue distinguir perfeitamente branco da arte e branco do fundo: desative a remoção interna para preservar detalhes fechados e diminua a intensidade se necessário. Para preservar branco que toca o fundo, prefira o arquivo original já transparente. Forçar o modo de transparência em uma imagem totalmente opaca mantém também o fundo opaco. O limite interno só se aplica aos espaços fechados.
- A suavização reduz irregularidades; ela pode arredondar detalhes muito finos. Ampliar uma imagem pequena não recupera detalhes e o programa avisa quando houver ampliação.
- O resultado é um PNG raster, sem caminho vetorial. O Design Space interpreta a transparência ao criar a silhueta. Faça um corte de teste: o acabamento físico também depende da lâmina, do material e da calibração.
- As dimensões aceitas em Print Then Cut dependem da máquina, do papel e das configurações no Design Space; a altura do aplicativo não é uma garantia de área imprimível.

## Desenvolvimento

Sem dependências de produção. `processing.js` usa flood fill para remover o fundo conectado, componentes para limpar pontos, fechamento morfológico e filtros para suavizar a máscara e distância euclidiana para calcular o contorno. O processamento acontece em um Web Worker; a interface permanece disponível.

`npm test` executa testes do processamento e da geometria do foil. `npm install` instala a ferramenta de teste de navegador; `npm run test:browser` verifica upload, ajustes, exportação, transparência e os metadados do PNG no Chrome local. `npm run test:editor` verifica gestos reais do pincel e das pontes, histórico, base, persistência dos presets e exportação original/espelhada com as edições. `npm run test:foil` verifica a galeria, colocação e movimento, ajustes, histórico, composição e o ZIP com os quatro PNGs, incluindo alinhamento, espelho, cores, transparência e resolução.
