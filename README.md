# Totem Studio

Aplicativo local para preparar imagens para totens: remove o branco conectado à borda, suaviza a silhueta, cria um contorno preto ou em degradê e exporta um PNG transparente.

## Abrir

No Windows, dê dois cliques em **Iniciar.bat**. Também pode abrir **index.html** no Chrome ou Edge. Não precisa instalar nada e funciona sem internet; suas imagens ficam no computador.

Como alternativa, com Node.js instalado, execute `npm start` e abra http://127.0.0.1:4173.

## Usar

1. Carregue um PNG, JPG ou WEBP sobre fundo branco. Há uma raposa de exemplo para experimentar.
2. Ajuste a remoção do branco e a suavização. A limpeza de pontos é opcional e pode apagar pequenos detalhes separados. **Remover espaços brancos internos** abre os espaços internos maiores e preserva os menores que o limite configurado, inicialmente **2 mm**. Desmarque para preservar todos os brancos internos; use **0 mm** para remover todos.
3. Escolha a espessura em milímetros e o degradê. O padrão começa cinza junto ao desenho e fica preto na borda externa. Em **Ajustes do degradê**, use **Profundidade do preto** para aumentar a faixa escura, **Intensidade do preto** para tornar o tom escuro mais leve ou mais forte, **Tom claro** para escolher a luminosidade do cinza e **Transição** para escolher uma passagem suave, linear ou mais marcada. A faixa de exemplo acompanha os ajustes. **Restaurar** retorna esses quatro controles ao padrão. Os ajustes ficam desabilitados com preto uniforme ou sem contorno. O contorno possui preenchimento opaco; apenas o limite tem antialiasing de um pixel. Esses controles alteram a cor do contorno, mantendo o tamanho e a silhueta de corte.
4. Confira **Silhueta de corte**, inclusive as aberturas internas. **União das bordas**, inicialmente em **2 mm**, fecha frestas estreitas entre os contornos já expandidos. O controle usa o tamanho final em milímetros; aumentar o valor une partes próximas e fecha mais reentrâncias, enquanto aberturas maiores permanecem. Use **0 mm** para desativar a união extra. O limite de espaços internos é verificado também no contorno final, evitando pequenos furos que aparecem apenas depois da expansão da borda. As uniões usam o tom do limite externo do acabamento e preservam a arte opaca, sem criar preenchimentos brancos. O PNG e a silhueta de corte recebem a mesma união, antes de gerar a cópia espelhada.
5. Defina a altura total do arquivo em centímetros e a resolução. Baixe o PNG. Para obter a frente e o verso, marque **Incluir cópia espelhada** junto ao botão de download. **Baixar 2 PNGs** entrega um ZIP com `nome-totem.png` e `nome-totem-espelhado.png`. Extraia o ZIP para usar as duas imagens. A cópia inverte esquerda e direita, mantendo tamanho, transparência, resolução e acabamento da imagem processada. Textos na arte também ficam espelhados.
6. No Cricut Design Space, importe o PNG e escolha **Print Then Cut / Imprimir e Cortar**. Confira o tamanho e a prévia antes da impressão. O aplicativo grava a resolução no campo pHYs do PNG, mas a interpretação do tamanho depende do programa de importação.

Guia oficial: [Como carregar imagens no Design Space](https://help.cricut.com/hc/en-us/articles/360009556313-How-to-upload-images-into-Design-Space).

## Limites e acabamento

- Arquivos de até 30 MB. Imagens acima de 80 megapixels são recusadas; a análise usa até 1800 pixels no maior lado para limitar o uso de memória. O tamanho de exportação é calculado separadamente.
- O PNG tem até 4096 pixels por lado e 12 megapixels. Reduza a altura ou a resolução se exceder esses limites.
- A altura inclui o contorno e uma pequena margem transparente de segurança. As cores da prévia de fundo não são exportadas.
- O limite dos espaços internos usa milímetros no tamanho final de exportação. Ele considera o diâmetro estimado do maior círculo que cabe na abertura, descontando o contorno, e confere novamente após a suavização. Uma fresta comprida e estreita pode ser preservada mesmo com grande área. A estimativa tem a precisão da grade de pixels do PNG.
- Com a remoção interna habilitada, áreas brancas cercadas pelo desenho também podem virar aberturas, inclusive detalhes brancos da própria arte. Desative a opção ou aumente o limite para preservá-los. Partes brancas abertas para o fundo podem ser removidas junto dele; diminua a intensidade e confira a prévia. O limite interno só se aplica aos espaços fechados.
- A suavização reduz irregularidades; ela pode arredondar detalhes muito finos. Ampliar uma imagem pequena não recupera detalhes e o programa avisa quando houver ampliação.
- O resultado é um PNG raster, sem caminho vetorial. O Design Space interpreta a transparência ao criar a silhueta. Faça um corte de teste: o acabamento físico também depende da lâmina, do material e da calibração.
- As dimensões aceitas em Print Then Cut dependem da máquina, do papel e das configurações no Design Space; a altura do aplicativo não é uma garantia de área imprimível.

## Desenvolvimento

Sem dependências de produção. `processing.js` usa flood fill para remover o fundo conectado, componentes para limpar pontos, fechamento morfológico e filtros para suavizar a máscara e distância euclidiana para calcular o contorno. O processamento acontece em um Web Worker; a interface permanece disponível.

`npm test` executa testes do processamento. `npm install` instala a ferramenta de teste de navegador; `npm run test:browser` verifica upload, ajustes, exportação, transparência e os metadados do PNG no Chrome local.
