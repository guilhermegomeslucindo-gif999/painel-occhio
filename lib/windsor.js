// Busca os dados do Meta Ads pelo Windsor.ai (usado quando não há token do Meta configurado).

const BASE = 'https://connectors.windsor.ai/facebook';

const MET = [
  'spend', 'reach', 'impressions', 'clicks', 'actions_link_click',
  'actions_onsite_conversion_messaging_conversation_started_7d', 'actions_lead',
  'actions_omni_purchase', 'action_values_omni_purchase',
];
const CAMP = ['campaign_id', 'campaign', 'campaign_objective', 'campaign_effective_status'];
const AD_FIELDS = [
  'campaign_id', 'campaign', 'adset_id', 'adset_name', 'ad_id', 'ad_name', 'effective_status', 'object_type',
  'thumbnail_url', 'ad_preview_shareable_link', 'spend', 'impressions', 'clicks', 'actions_link_click',
  'actions_onsite_conversion_messaging_conversation_started_7d', 'actions_lead',
];
const DAILY_FIELDS = ['date', 'campaign_id', 'spend', 'actions_link_click',
  'actions_onsite_conversion_messaging_conversation_started_7d', 'actions_lead'];

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

class SourceError extends Error {
  constructor(message, code, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function makeWindsor(key, account, refresh) {
  return async function windsor(fields, from, to) {
    const url = new URL(BASE);
    url.searchParams.set('api_key', key);
    url.searchParams.set('select_accounts', account);
    url.searchParams.set('date_from', from);
    url.searchParams.set('date_to', to);
    url.searchParams.set('fields', fields.join(','));
    if (refresh) {
      url.searchParams.set('refresh_since', '3d');
      url.searchParams.set('refresh_interval', refresh);
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
      if (r.status === 401 || r.status === 403 || last.code === 'authentication_error') break;
      if (r.status < 500 && r.status !== 429 && !(j && j.status === 'pending')) break;
      await new Promise((ok) => setTimeout(ok, 1000 * (attempt + 1)));
    }
    let msg = last.message || 'Erro do Windsor.ai';
    if (last.code === 'authentication_error' || /api key/i.test(msg)) {
      msg = 'A chave do Windsor.ai está errada ou foi trocada. Copie de novo em app.windsor.ai e atualize WINDSOR_API_KEY na Vercel. (' + msg + ')';
    }
    throw new SourceError(msg, last.code || null, 502);
  };
}

module.exports = async function fromWindsor({ key, account, refresh, start, end, prevStart, prevEnd, part }) {
  const windsor = makeWindsor(key, account, refresh);
  const quer = (p) => part === 'tudo' || part === p;
  const nada = Promise.resolve(null);

  const [acc, accPrev, camp, campPrev, daily, adRows] = await Promise.all([
    quer('resumo') ? windsor(['account_name', 'account_currency', ...MET], start, end) : nada,
    quer('resumo') ? windsor(['account_name', ...MET], prevStart, prevEnd) : nada,
    quer('resumo') ? windsor([...CAMP, ...MET], start, end) : nada,
    quer('resumo') ? windsor(['campaign_id', ...MET], prevStart, prevEnd) : nada,
    quer('resumo') ? windsor(DAILY_FIELDS, start, end) : nada,
    quer('anuncios') ? windsor(AD_FIELDS, start, end) : nada,
  ]);

  const body = { account: { id: account, name: '', currency: 'BRL' } };

  if (quer('resumo')) {
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
    // Um anúncio pode vir em mais de uma linha: soma
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

  return body;
};

module.exports.SourceError = SourceError;
