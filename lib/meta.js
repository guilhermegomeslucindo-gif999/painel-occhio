// Busca os dados direto na API de Marketing do Meta (gratuita).
// Usado quando META_ACCESS_TOKEN está configurado na Vercel.

const crypto = require('crypto');

const LEAD_TYPES = ['onsite_conversion.messaging_conversation_started_7d', 'lead'];
const INSIGHT_FIELDS = 'spend,reach,impressions,clicks,inline_link_clicks,actions,action_values';
const CAMPAIGN_STATUSES = ['ACTIVE', 'PAUSED', 'IN_PROCESS', 'WITH_ISSUES', 'ARCHIVED'];
const AD_FIELDS = 'id,name,effective_status,campaign_id,adset{id,name},preview_shareable_link,'
  + 'creative.thumbnail_width(480).thumbnail_height(600){thumbnail_url,image_url,object_type,video_id}';

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const sumActions = (list, types) => (list || []).filter((a) => types.includes(a.action_type)).reduce((s, a) => s + num(a.value), 0);

// omni_purchase (todas as fontes); se não houver, purchase. Nunca soma os dois.
function purchaseOf(list) {
  const arr = list || [];
  const omni = arr.find((a) => a.action_type === 'omni_purchase');
  if (omni) return num(omni.value);
  const p = arr.find((a) => a.action_type === 'purchase' || a.action_type === 'offsite_conversion.fb_pixel_purchase');
  return p ? num(p.value) : 0;
}

function metrics(row) {
  const r = row || {};
  return {
    spend: num(r.spend),
    reach: num(r.reach),
    impressions: num(r.impressions),
    clicks: num(r.clicks),
    link_clicks: num(r.inline_link_clicks),
    leads: sumActions(r.actions, LEAD_TYPES),
    purchases: purchaseOf(r.actions),
    revenue: purchaseOf(r.action_values),
  };
}

class SourceError extends Error {
  constructor(message, code, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function makeGraph(token, version, appSecret) {
  const proof = appSecret ? crypto.createHmac('sha256', appSecret).update(token).digest('hex') : null;

  async function getJson(url) {
    let last;
    for (let attempt = 0; attempt < 3; attempt++) {
      let j;
      try {
        const r = await fetch(url);
        j = await r.json().catch(() => ({ error: { message: 'Resposta inválida do Meta (HTTP ' + r.status + ')' } }));
      } catch (e) {
        j = { error: { message: 'Não foi possível falar com o Meta.', is_transient: true } };
      }
      if (!j.error) return j;
      last = j.error;
      const temporario = j.error.is_transient || [1, 2, 4, 17, 341, 80004].includes(j.error.code);
      if (!temporario) break;
      await new Promise((ok) => setTimeout(ok, 800 * (attempt + 1)));
    }
    let msg = last.error_user_msg || last.message || 'Erro do Meta';
    if (last.code === 190) msg = 'O token do Meta expirou ou é inválido. Gere um novo e atualize META_ACCESS_TOKEN na Vercel. (' + msg + ')';
    else if (last.code === 10 || last.code === 200 || (last.code === 100 && /permission|permiss/i.test(msg))) {
      msg = 'O token não tem acesso a esta conta de anúncios. Confira se o Usuário do Sistema recebeu a conta e a permissão ads_read. (' + msg + ')';
    } else if ([4, 17, 80004].includes(last.code)) msg = 'O Meta limitou as consultas por alguns minutos. Tente de novo em instantes.';
    throw new SourceError(msg, last.code || null, 502);
  }

  // Faz a chamada e segue a paginação. Uma resposta que não é lista volta como objeto.
  return async function graph(path, params = {}, maxPages = 25) {
    const url = new URL(`https://graph.facebook.com/${version}${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, typeof v === 'string' ? v : JSON.stringify(v));
    url.searchParams.set('access_token', token);
    if (proof) url.searchParams.set('appsecret_proof', proof);
    const first = await getJson(url.toString());
    if (!Array.isArray(first.data)) return first;
    let out = first.data;
    let next = first.paging && first.paging.next;
    let pages = 1;
    while (next && pages < maxPages) {
      const j = await getJson(next);
      out = out.concat(j.data || []);
      next = j.paging && j.paging.next;
      pages += 1;
    }
    return out;
  };
}

module.exports = async function fromMeta({ token, version, appSecret, account, start, end, prevStart, prevEnd, part }) {
  const graph = makeGraph(token, version || 'v23.0', appSecret);
  const act = `/act_${account}`;
  const quer = (p) => part === 'tudo' || part === p;
  const nada = Promise.resolve(null);
  const insights = (level, since, until, fields, extra = {}) => graph(`${act}/insights`, {
    level, fields, time_range: { since, until }, use_unified_attribution_setting: true, limit: 500, ...extra,
  });

  const [info, acc, accPrev, camp, campPrev, daily, campEnt, adRows, adEnt] = await Promise.all([
    quer('resumo') ? graph(act, { fields: 'name,currency' }) : nada,
    quer('resumo') ? insights('account', start, end, INSIGHT_FIELDS) : nada,
    quer('resumo') ? insights('account', prevStart, prevEnd, INSIGHT_FIELDS) : nada,
    quer('resumo') ? insights('campaign', start, end, 'campaign_id,campaign_name,' + INSIGHT_FIELDS) : nada,
    quer('resumo') ? insights('campaign', prevStart, prevEnd, 'campaign_id,' + INSIGHT_FIELDS) : nada,
    quer('resumo') ? insights('campaign', start, end, 'campaign_id,spend,inline_link_clicks,actions', { time_increment: 1 }) : nada,
    graph(`${act}/campaigns`, {
      fields: 'id,name,objective,effective_status',
      filtering: [{ field: 'effective_status', operator: 'IN', value: CAMPAIGN_STATUSES }],
      limit: 500,
    }),
    quer('anuncios') ? insights('ad', start, end, 'ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,' + INSIGHT_FIELDS) : nada,
    // Só os anúncios ativos agora (lista pequena). Os que rodaram no período vêm dos insights abaixo.
    quer('anuncios') ? graph(`${act}/ads`, {
      fields: AD_FIELDS,
      filtering: [{ field: 'effective_status', operator: 'IN', value: ['ACTIVE'] }],
      limit: 200,
    }) : nada,
  ]);

  const campInfo = new Map(campEnt.map((c) => [String(c.id), c]));
  const body = { account: { id: account, name: '', currency: 'BRL' } };

  if (quer('resumo')) {
    body.account.name = info.name || '';
    body.account.currency = info.currency || 'BRL';
    body.totals = { cur: metrics(acc[0]), prev: metrics(accPrev[0]) };
    // Campanhas com entrega no período + todas as ativas agora (mesmo sem gasto ainda)
    const cur = new Map(camp.map((r) => [String(r.campaign_id), r]));
    const prv = new Map(campPrev.map((r) => [String(r.campaign_id), r]));
    const ids = new Set([...cur.keys(), ...campEnt.filter((c) => c.effective_status === 'ACTIVE').map((c) => String(c.id))]);
    body.campaigns = [...ids].map((id) => {
      const e = campInfo.get(id) || {};
      const r = cur.get(id);
      return {
        id,
        name: e.name || (r && r.campaign_name) || id,
        objective: e.objective || '',
        status: e.effective_status || '',
        cur: metrics(r),
        prev: metrics(prv.get(id)),
      };
    });
    body.daily = daily.map((r) => ({
      date: String(r.date_start).slice(0, 10),
      campaign_id: String(r.campaign_id),
      spend: num(r.spend),
      link_clicks: num(r.inline_link_clicks),
      leads: sumActions(r.actions, LEAD_TYPES),
    }));
  }

  if (quer('anuncios')) {
    // Anúncios com entrega no período + todos os ativos agora (mesmo sem gasto ainda)
    const info2 = new Map(adEnt.map((a) => [String(a.id), a]));
    // Detalhes (capa, status, link) dos que rodaram no período e não estão ativos: busca só esses, 50 por vez
    const faltam = [...new Set(adRows.map((r) => String(r.ad_id)))].filter((id) => !info2.has(id));
    const lotes = [];
    for (let i = 0; i < faltam.length; i += 50) lotes.push(faltam.slice(i, i + 50));
    const extras = await Promise.all(lotes.map((ids) => graph('/', { ids: ids.join(','), fields: AD_FIELDS })));
    for (const lote of extras) for (const a of Object.values(lote || {})) if (a && a.id) info2.set(String(a.id), a);
    const cur = new Map(adRows.map((r) => [String(r.ad_id), r]));
    const ids = new Set([...cur.keys(), ...adEnt.filter((a) => a.effective_status === 'ACTIVE').map((a) => String(a.id))]);
    body.ads = [...ids].map((id) => {
      const e = info2.get(id) || {};
      const r = cur.get(id) || {};
      const cr = e.creative || {};
      const campaignId = String(e.campaign_id || r.campaign_id || '');
      return {
        id,
        name: e.name || r.ad_name || id,
        status: e.effective_status || '',
        campaign_id: campaignId,
        campaign: (campInfo.get(campaignId) || {}).name || r.campaign_name || '',
        adset: (e.adset && e.adset.name) || r.adset_name || '',
        format: cr.video_id || cr.object_type === 'VIDEO' ? 'video' : 'image',
        thumb: cr.thumbnail_url || cr.image_url || '',
        preview: e.preview_shareable_link || '',
        cur: metrics(r),
      };
    });
  }

  return body;
};

module.exports.SourceError = SourceError;
