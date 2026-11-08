AgroMapa v0.8 — app instalável (PWA). Publicado no GitHub Pages. Os dados ficam no aparelho de quem usa; este repositório tem só o código.

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

Publique `index.html`, `backup.js`, `storage.js`, `account-store.js`, `account-migration.js`, `sw.js` e os demais recursos juntos. Ao alterar os arquivos da aplicação, atualize o nome de cache em `sw.js` para oferecer a nova versão aos aplicativos instalados. O banco não é apagado por essa atualização.

Os testes de falhas usam uma simulação de IndexedDB; a verificação manual no Chrome cobre a gravação real com a biblioteca `idb` e a leitura após recarregar. A API, as migrações SQL e as políticas de acesso não estão neste repositório; sincronização entre contas/aparelhos exige validação com esse servidor.

## Dados separados por conta

Cada conta usa um banco próprio, identificado pelo ID do usuário. O modo sem login também tem seu banco. Sair salva as alterações antes de trocar de espaço; uma falha impede a troca. A fila de envio, exclusões pendentes, versões, conflitos e fotos continuam na origem. Outras abas detectam a troca; operações antigas continuam vinculadas ao banco original.

O banco antigo agromapa permanece intacto. A migração copia propriedades locais sem vínculo com contas para o modo local. Propriedades de contas são recuperadas somente com vínculo conhecido ou autorização retornada pelo servidor. Dados sem atribuição segura permanecem no original. Cada propriedade é atribuída uma única vez e copiada atomicamente com sua fila; repetir a migração não repõe envios concluídos. Colisões interrompem a cópia sem sobrescrever registros. O formato antigo state2 também é preservado.

Em Ajustes, uma conta pode copiar explicitamente propriedades do modo local. A origem permanece intacta. Limpar os dados afeta somente o espaço aberto. A separação é lógica, não criptografia nem substituto das políticas de acesso do servidor.

Para verificar o IndexedDB real, abra /tests/browser-accounts.html na prévia e execute os testes. Usam bancos temporários e contas fictícias, cobrindo alternância, fila, fotos e migração nos adaptadores nativo e idb. O login real e a sincronização com o servidor não foram validados: a configuração e o serviço de autenticação não estão neste repositório.
