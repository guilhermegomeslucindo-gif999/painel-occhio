// Função de servidor (Vercel) que busca os dados da conta de anúncios do Meta pelo Windsor.ai.
// A chave fica só aqui no servidor, nas variáveis de ambiente da Vercel. Ela nunca vai para o navegador.
//
// Variáveis de ambiente:
//   WINDSOR_API_KEY           (obrigatória) chave da API do Windsor.ai (app.windsor.ai → API Key)
//   META_AD_ACCOUNT_ID        (opcional)    padrão: 465585599582830 (CA - Occhio Blu)
//   WINDSOR_REFRESH_INTERVAL  (opcional)    de quanto em quanto tempo o Windsor busca de novo no Meta.
//                                           Sem a variável, vale o padrão do plano (o teste grátis não aceita intervalo em horas).
//                                           Com plano pago: 1h (Standard/Plus) ou 15min (Professional/Enterprise).

const ACCOUNT = String(process.env.META_AD_ACCOUNT_ID || '465585599582830').replace(/^act_/, '').trim();
const REFRESH = (process.env.WINDSOR_REFRESH_INTERVAL || '').trim();
const BASE = 'https://connectors.windsor.ai/facebook';
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const MET = [
  'spend', 'reach', 'impressions', 'clicks', 'actions_link_click',
  'actions_onsite_conversion_messaging_conversation_started_7d', 'actions_lead',
  'actions_omni_purchase', 'action_values_omni_purchase',
];
const CAMP = ['campaign_id', 'campaign', 'campaign_objective', 'campaign_effective_status'];

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function metrics(row) {
  const r = row || {};
  return {
    spend: num(r.spend),
    reach: num(r.reach),
    impressions: num(r.impressions),
    clicks: num(r.clicks),
    link_clicks: num(r.actions_link_click),
    leads: num(r.actions_onsite_conversion_messaging_conversation_started_7d) + num(r.actions_lead),
    purchases: num(r.actions_omni_purchase),
    revenue: num(r.action_values_omni_purchase),
  };
}

const addDays = (iso, d) => new Date(Date.parse(iso + 'T00:00:00Z') + d * 864e5).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5) + 1;
const todaySP = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);

class WindsorError extends Error {
  constructor(message, code, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function makeWindsor(key) {
  return async function windsor(fields, from, to) {
    const url = new URL(BASE);
    url.searchParams.set('api_key', key);
    url.searchParams.set('select_accounts', ACCOUNT);
    url.searchParams.set('date_from', from);
    url.searchParams.set('date_to', to);
    url.searchParams.set('fields', fields.join(','));
    if (REFRESH) {
      url.searchParams.set('refresh_since', '3d');
      url.searchParams.set('refresh_interval', REFRESH);
    }

    let last = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      let r;
      try {
        r = await fetch(url.toString());
      } catch (e) {
        last = { message: 'Não foi possível falar com o Windsor.ai.' };
        await new Promise((ok) => setTimeout(ok, 800 * (attempt + 1)));
        continue;
      }
      const j = await r.json().catch(() => null);
      if (j && Array.isArray(j.data) && !j.error) return j.data;
      if (Array.isArray(j)) return j;
      // O Windsor devolve o erro como {error: {code, message}} ou como {error: "texto", code: "..."}
      if (j && typeof j.error === 'string') last = { message: j.error, code: j.code };
      else last = (j && j.error) || { message: 'Resposta inesperada do Windsor.ai (HTTP ' + r.status + ').' };
      // Chave errada ou plano: não adianta tentar de novo
      if (r.status === 401 || r.status === 403 || last.code === 'authentication_error') break;
      if (r.status < 500 && r.status !== 429 && !(j && j.status === 'pending')) break;
      await new Promise((ok) => setTimeout(ok, 1000 * (attempt + 1)));
    }
    throw new WindsorError(last.message || 'Erro do Windsor.ai', last.code || null, 502);
  };
}

function send(res, status, body, cache) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', cache || 'no-store');
  res.end(JSON.stringify(body));
}

module.exports = async function handler(req, res) {
  const key = process.env.WINDSOR_API_KEY;
  if (!key) {
    return send(res, 500, {
      error: 'Falta configurar a variável WINDSOR_API_KEY na Vercel (Settings → Environment Variables) e fazer o Redeploy. Veja o README.',
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
  const prevStart = addDays(start, -n);
  const prevEnd = addDays(start, -1);
  const fresh = Boolean(q.fresh);

  const windsor = makeWindsor(key);
  // part=resumo: números, campanhas e gráfico · part=anuncios: lista de anúncios · sem part: tudo
  const part = q.part === 'resumo' || q.part === 'anuncios' ? q.part : 'tudo';
  const quer = (p) => part === 'tudo' || part === p;
  const nada = Promise.resolve(null);
  const AD_FIELDS = [
    'campaign_id', 'campaign', 'adset_id', 'adset_name', 'ad_id', 'ad_name', 'effective_status', 'object_type',
    'thumbnail_url', 'ad_preview_shareable_link', 'spend', 'impressions', 'clicks', 'actions_link_click',
    'actions_onsite_conversion_messaging_conversation_started_7d', 'actions_lead',
  ];
  const DAILY_FIELDS = ['date', 'campaign_id', 'spend', 'actions_link_click',
    'actions_onsite_conversion_messaging_conversation_started_7d', 'actions_lead'];

  try {
    const [acc, accPrev, camp, campPrev, daily, adRows] = await Promise.all([
      quer('resumo') ? windsor(['account_name', 'account_currency', ...MET], start, end) : nada,
      quer('resumo') ? windsor(['account_name', ...MET], prevStart, prevEnd) : nada,
      quer('resumo') ? windsor([...CAMP, ...MET], start, end) : nada,
      quer('resumo') ? windsor(['campaign_id', ...MET], prevStart, prevEnd) : nada,
      quer('resumo') ? windsor(DAILY_FIELDS, start, end) : nada,
      quer('anuncios') ? windsor(AD_FIELDS, start, end) : nada,
    ]);

    const body = {
      account: { id: ACCOUNT, name: '', currency: 'BRL' },
      period: { start, end, prev_start: prevStart, prev_end: prevEnd },
      generated_at: new Date().toISOString(),
    };

    if (quer('resumo')) {
      // Campanhas que tiveram entrega no período
      const prevById = new Map(campPrev.map((r) => [String(r.campaign_id), r]));
      body.account.name = (acc[0] && acc[0].account_name) || '';
      body.account.currency = (acc[0] && acc[0].account_currency) || 'BRL';
      body.totals = { cur: metrics(acc[0]), prev: metrics(accPrev[0]) };
      body.campaigns = camp.filter((r) => r.campaign_id).map((r) => ({
        id: String(r.campaign_id),
        name: r.campaign || String(r.campaign_id),
        objective: r.campaign_objective || '',
        status: r.campaign_effective_status || '',
        cur: metrics(r),
        prev: metrics(prevById.get(String(r.campaign_id))),
      }));
      body.daily = daily.filter((r) => r.date).map((r) => ({
        date: String(r.date).slice(0, 10),
        campaign_id: String(r.campaign_id),
        spend: num(r.spend),
        link_clicks: num(r.actions_link_click),
        leads: num(r.actions_onsite_conversion_messaging_conversation_started_7d) + num(r.actions_lead),
      }));
    }

    if (quer('anuncios')) {
      // Anúncios que tiveram entrega no período (um anúncio pode vir em mais de uma linha: soma)
      const ads = new Map();
      for (const r of adRows) {
        if (!r.ad_id) continue;
        const id = String(r.ad_id);
        const m = metrics(r);
        const a = ads.get(id);
        if (a) {
          for (const k of Object.keys(m)) a.cur[k] += m[k];
          continue;
        }
        ads.set(id, {
          id,
          name: r.ad_name || id,
          status: r.effective_status || '',
          campaign_id: String(r.campaign_id || ''),
          campaign: r.campaign || '',
          adset: r.adset_name || '',
          format: r.object_type === 'VIDEO' ? 'video' : 'image',
          thumb: r.thumbnail_url || '',
          preview: r.ad_preview_shareable_link || '',
          cur: m,
        });
      }
      body.ads = [...ads.values()];
    }

    // Cache na Vercel: 15 min "fresco" e, depois disso, mostra a última versão na hora enquanto atualiza por trás.
    // O Windsor só busca dados novos no Meta de tempos em tempos, então isso não atrasa nada na prática.
    return send(res, 200, body, fresh ? 'no-store' : 's-maxage=900, stale-while-revalidate=86400');
  } catch (err) {
    let msg = err.message || 'Erro ao buscar os dados.';
    if (err.code === 'authentication_error' || /api key/i.test(msg)) {
      msg = 'A chave do Windsor.ai está errada ou foi trocada. Copie de novo em app.windsor.ai e atualize WINDSOR_API_KEY na Vercel. (' + msg + ')';
    }
    return send(res, err.status || 500, { error: msg, code: err.code || null });
  }
};

// Exportado só para os testes
module.exports._internals = { metrics, addDays, daysBetween };
