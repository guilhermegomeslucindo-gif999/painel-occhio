# Painel Occhio Blu · Meta Ads

Painel de performance da conta de anúncios **CA – Occhio Blu** (act_465585599582830), feito pela QH4.

Os dados vêm **ao vivo** do Meta Ads pelo **Windsor.ai** sempre que alguém abre ou recarrega a página:

- campanhas novas aparecem sozinhas assim que começam a rodar;
- anúncios novos aparecem sozinhos, com capa, formato (vídeo ou imagem), status e links para a prévia e para o Gerenciador;
- vendas, faturamento, CPA e ROAS são preenchidos automaticamente quando o Meta registrar compras;
- cada número é comparado com o período anterior de mesmo tamanho.

Ninguém precisa mexer no código quando uma campanha ou um anúncio for criado.

---

## Configuração (uns 5 minutos, uma vez só)

### 1. Copiar a chave do Windsor

1. Acesse **app.windsor.ai** e faça login com a mesma conta onde a Occhio Blu está conectada.
2. Procure a **API Key**. Ela aparece na página inicial ou no menu da sua conta, com um botão de copiar.
3. Copie a chave.

> A chave é uma senha de leitura dos seus dados do Windsor. Não mande por WhatsApp e não coloque no GitHub.

### 2. Subir no GitHub

1. Crie um repositório **privado**, por exemplo `occhioblu-dashboard`.
2. Envie todos os arquivos desta pasta. **Não** envie arquivos `.env`; o `.gitignore` já impede isso.

### 3. Publicar na Vercel

1. Em **vercel.com → Add New → Project**, importe o repositório.
2. Em **Framework Preset**, deixe **Other**. Não precisa mudar mais nada.
3. Abra **Environment Variables** e cadastre:
   - **Key:** `WINDSOR_API_KEY`
   - **Value:** a chave copiada do Windsor
4. Clique em **Deploy**. O link que a Vercel mostrar é o painel.

**Já tinha publicado antes?** Vá em **Settings → Environment Variables**, cadastre `WINDSOR_API_KEY` e depois em **Deployments → ⋯ → Redeploy**.

---

## Compartilhar

Qualquer pessoa com o link vê o painel: você, outro gestor ou a cliente. Não precisa de login.
O link guarda o período e a campanha escolhidos, por exemplo `…/?inicio=2026-10-01&fim=2026-10-31&campanha=120252327956700463`.
Tema e paleta ficam salvos no navegador de cada pessoa.

O painel não aparece no Google (`noindex`). Se quiser exigir senha, a Vercel tem **Password Protection** nos planos pagos.

## De quanto em quanto tempo atualiza

- O painel busca no Windsor toda vez que é aberto. O botão **“Atualizar agora”** força a busca.
- No **teste grátis** do Windsor vale o intervalo padrão dele para buscar de novo os dados recentes no Meta (algumas horas).
- Com **plano pago**, dá para deixar mais rápido cadastrando na Vercel `WINDSOR_REFRESH_INTERVAL` = `1h` (Standard/Plus) ou `15min` (Professional/Enterprise) e fazendo o Redeploy.
  No teste grátis **não** cadastre essa variável: o Windsor recusa (“Hourly data is not available for TRIAL”).
- Uma campanha ou um anúncio novo aparece depois da **primeira entrega** (primeiras impressões) e da próxima atualização do Windsor.

---

## Definições dos números

- **Leads** = conversas iniciadas no WhatsApp (pessoas sem contato há 7+ dias) + cadastros em formulário.
- **Cliques no link** = cliques que levaram ao WhatsApp, site ou perfil.
- **Vendas / Faturamento** = compras registradas pelo Meta (pixel, API de Conversões ou WhatsApp).
- **CTR** = cliques no link ÷ impressões · **CPC** = investimento ÷ cliques no link · **Custo por lead** = investimento ÷ leads
- **CPA** = investimento ÷ vendas · **ROAS** = faturamento ÷ investimento
- **Período anterior**: o mesmo número de dias, logo antes do período escolhido.

## Problemas comuns

| Mensagem no painel | O que fazer |
|---|---|
| “Falta configurar a variável WINDSOR_API_KEY” | Cadastre a chave na Vercel e faça o Redeploy |
| “A chave do Windsor.ai está errada” | Copie de novo em app.windsor.ai (sem espaços), atualize na Vercel e faça o Redeploy |
| “Hourly data is not available for TRIAL” | Apague a variável `WINDSOR_REFRESH_INTERVAL` na Vercel (ou assine um plano) e faça o Redeploy |
| Painel abre sem nenhuma campanha | Confirme no Windsor que a conta “CA – Occhio Blu” continua conectada |
| Capa “indisponível” | O link da imagem do Meta venceu. Clique em “Atualizar agora” |

## Arquivos

| Arquivo | O que é |
|---|---|
| `index.html` | O painel (visual, filtros, temas, gráfico, galeria de anúncios) |
| `api/meta.js` | Função de servidor que consulta o Windsor e devolve os dados prontos. A chave fica só aqui |
| `vercel.json` | Configurações da Vercel |
| `test/meta.test.js` | Testes da função com dados simulados (`npm test`) |
| `.env.example` | Modelo das variáveis |

**Outro cliente?** Publique uma cópia e cadastre também `META_AD_ACCOUNT_ID` com o número da conta de anúncios dele, que precisa estar conectada no mesmo Windsor.
