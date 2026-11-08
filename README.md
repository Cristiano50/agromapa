AgroMapa v0.7 — app instalável (PWA). Publicado no GitHub Pages. Os dados ficam no aparelho de quem usa; este repositório tem só o código.

## Executar e verificar

Requer Node.js 24. Não é necessário instalar dependências para a prévia ou os testes.

```sh
node tools/serve.cjs
node --test tests/*.test.cjs
```

Abra `http://127.0.0.1:4173`. A prévia usa dados próprios dessa origem; não altera os dados do site publicado. O mapa e as fontes ainda dependem das bibliotecas e serviços externos no primeiro acesso.

## Gravação e sincronização

- Registros, fila de envio e estado local são gravados na mesma transação IndexedDB. O controle de alterações avança somente após a confirmação da transação.
- Salvamentos são serializados. Uma falha mantém as alterações disponíveis para uma nova tentativa enquanto a página permanece aberta.
- Autenticação e API têm limite de espera de 20 segundos; arquivos, importações e laudos usam 60 segundos, incluindo leitura da resposta. A sincronização pode ser tentada novamente após uma falha de rede.
- A restauração prepara uma cópia do estado e valida listas, identificadores, coordenadas e referências de propriedade antes de aplicar o backup. Arquivos maiores que 20 MB ou com mais de 100 mil registros são recusados.
- `backup.js` concentra a preparação do backup, sem acesso ao DOM ou ao banco. Os testes dessa rotina e da persistência ficam em `tests/` e podem ser executados pelo comando acima. A configuração de GitHub Actions foi preparada localmente, mas não publicada: a conexão atual não possui permissão para criar workflows.

## Interface

O mapa no celular mantém a navegação visível, oferece um painel recolhível e agrupa as camadas em um menu. Formulários usam uma coluna em telas estreitas, controles maiores e fonte de 16 px. Alertas e tarefas precedem o perfil da propriedade. Gráficos oferecem uma tabela de valores e o menu Mais permite navegação por teclado e fechamento com Escape.

## Publicação e limites da validação

Publique `index.html`, `backup.js`, `sw.js` e os demais recursos juntos. Ao alterar os arquivos da aplicação, atualize o nome de cache em `sw.js` para oferecer a nova versão aos aplicativos instalados. O banco não é apagado por essa atualização.

Os testes de falhas usam uma simulação de IndexedDB; a verificação manual no Chrome cobre a gravação real com a biblioteca `idb` e a leitura após recarregar. A API, as migrações SQL e as políticas de acesso não estão neste repositório; sincronização entre contas/aparelhos exige validação com esse servidor.

O banco local continua compartilhado pelas contas que usam o mesmo perfil de navegador. Separá-lo por usuário requer uma migração que preserve dados e envios pendentes; essa alteração não está incluída nesta revisão. Use perfis de navegador separados em aparelhos compartilhados até essa migração.
