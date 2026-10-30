// Função de servidor (Vercel) que entrega os dados do painel.
// As chaves ficam só aqui no servidor, nas variáveis de ambiente da Vercel. Nunca vão para o navegador.
//
// De onde vêm os dados (escolha automática):
//   1. META_ACCESS_TOKEN configurado  → direto na API do Meta (gratuito, recomendado)
//   2. senão, WINDSOR_API_KEY         → pelo Windsor.ai
//
// Variáveis de ambiente:
//   META_ACCESS_TOKEN         token de Usuário do Sistema com a permissão ads_read
//   META_APP_SECRET           (opcional) chave secreta do app; deixa as chamadas ao Meta mais seguras
//   META_API_VERSION          (opcional) padrão: v23.0
//   WINDSOR_API_KEY           chave da API do Windsor.ai (só se não usar o token do Meta)
//   WINDSOR_REFRESH_INTERVAL  (opcional, só com plano pago do Windsor) 1h ou 15min
//   META_AD_ACCOUNT_ID        (opcional) padrão: 465585599582830 (CA - Occhio Blu)

const fromMeta = require('../lib/meta.js');
const fromWindsor = require('../lib/windsor.js');

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const addDays = (iso, d) => new Date(Date.parse(iso + 'T00:00:00Z') + d * 864e5).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5) + 1;
const todaySP = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);

function send(res, status, body, cache) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', cache || 'no-store');
  res.end(JSON.stringify(body));
}

module.exports = async function handler(req, res) {
  const env = process.env;
  const token = (env.META_ACCESS_TOKEN || '').trim();
  const windsorKey = (env.WINDSOR_API_KEY || '').trim();
  const account = String(env.META_AD_ACCOUNT_ID || '465585599582830').replace(/^act_/, '').trim();

  if (!token && !windsorKey) {
    return send(res, 500, {
      error: 'Falta configurar META_ACCESS_TOKEN (ou WINDSOR_API_KEY) na Vercel (Settings → Environment Variables) e fazer o Redeploy. Veja o README.',
    });
  }

  const q = req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams);
  let start = String(q.start || '');
  let end = String(q.end || '');
  if (!DAY.test(start) || !DAY.test(end)) {
    end = todaySP();
    start = end.slice(0, 8) + '01';
  }
  if (start > end) return send(res, 400, { error: 'A data inicial é depois da data final.' });
  const n = daysBetween(start, end);
  if (n > 400) return send(res, 400, { error: 'Escolha um período de até 400 dias.' });
  const period = { start, end, prev_start: addDays(start, -n), prev_end: addDays(start, -1) };
  // part=resumo: números, campanhas e gráfico · part=anuncios: lista de anúncios · sem part: tudo
  const part = q.part === 'resumo' || q.part === 'anuncios' ? q.part : 'tudo';
  const fresh = Boolean(q.fresh);
  const args = { account, start, end, prevStart: period.prev_start, prevEnd: period.prev_end, part };

  try {
    const body = token
      ? await fromMeta({ ...args, token, version: (env.META_API_VERSION || '').trim() || 'v23.0', appSecret: (env.META_APP_SECRET || '').trim() })
      : await fromWindsor({ ...args, key: windsorKey, refresh: (env.WINDSOR_REFRESH_INTERVAL || '').trim() });
    body.period = period;
    body.source = token ? 'meta' : 'windsor';
    body.generated_at = new Date().toISOString();
    // Cache na Vercel: 15 min "fresco"; depois mostra a última versão na hora enquanto atualiza por trás.
    return send(res, 200, body, fresh ? 'no-store' : 's-maxage=900, stale-while-revalidate=86400');
  } catch (err) {
    return send(res, err.status || 500, { error: err.message || 'Erro ao buscar os dados.', code: err.code || null });
  }
};
