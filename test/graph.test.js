// Testa o modo "direto no Meta" (lib/meta.js) com respostas simuladas da API do Meta (sem rede).
const assert = require('assert');

process.env.META_ACCESS_TOKEN = 'TOKEN_DE_TESTE';
process.env.WINDSOR_API_KEY = 'NAO_DEVE_SER_USADA';
process.env.META_AD_ACCOUNT_ID = 'act_465585599582830';

const act = (type, value) => ({ action_type: type, value: String(value) });
let windsorUsado = false;

function respond(u) {
  const url = new URL(u);
  if (url.hostname.includes('windsor')) { windsorUsado = true; return { data: [] }; }
  assert.strictEqual(url.hostname, 'graph.facebook.com');
  const p = url.pathname;
  const level = url.searchParams.get('level');
  const range = JSON.parse(url.searchParams.get('time_range') || '{}');
  const prev = range.since && range.since < '2026-10-01';

  if (p.endsWith('/act_465585599582830')) return { name: 'CA - Occhio Blu', currency: 'BRL', id: 'act_465585599582830' };
  if (p.endsWith('/insights') && level === 'account') {
    return { data: [prev
      ? { spend: '1326.05', reach: '6012', impressions: '19940', clicks: '1113', inline_link_clicks: '827',
          actions: [act('onsite_conversion.messaging_conversation_started_7d', 20), act('omni_purchase', 1), act('purchase', 1)],
          action_values: [act('omni_purchase', 598), act('purchase', 598)] }
      : { spend: '535.65', reach: '8806', impressions: '18758', clicks: '498', inline_link_clicks: '406',
          actions: [act('onsite_conversion.messaging_conversation_started_7d', 40)] }] };
  }
  if (p.endsWith('/insights') && level === 'campaign' && url.searchParams.get('time_increment')) {
    return { data: [{ campaign_id: '111', date_start: '2026-10-19', spend: '24.64', inline_link_clicks: '19', actions: [act('onsite_conversion.messaging_conversation_started_7d', 14)] }] };
  }
  if (p.endsWith('/insights') && level === 'campaign') {
    return { data: prev
      ? [{ campaign_id: '111', spend: '100', inline_link_clicks: '40', actions: [act('lead', 4)] }]
      : [{ campaign_id: '111', campaign_name: 'Vendas WPP', spend: '139.37', reach: '2339', impressions: '2979', inline_link_clicks: '66',
          actions: [act('onsite_conversion.messaging_conversation_started_7d', 36)] }] };
  }
  if (p.endsWith('/insights') && level === 'ad') {
    return { data: [{ ad_id: '9001', ad_name: 'Ponto de luz', adset_name: '[PUB QUENTE]', campaign_id: '111', campaign_name: 'Vendas WPP',
      spend: '94.78', impressions: '2072', inline_link_clicks: '45', actions: [act('onsite_conversion.messaging_conversation_started_7d', 21)] }] };
  }
  if (p.endsWith('/campaigns')) {
    return { data: [
      { id: '111', name: 'Vendas WPP', objective: 'OUTCOME_SALES', effective_status: 'PAUSED' },
      { id: '333', name: 'Campanha nova sem gasto', objective: 'OUTCOME_SALES', effective_status: 'ACTIVE' },
      { id: '444', name: 'Pausada antiga', objective: 'OUTCOME_SALES', effective_status: 'PAUSED' },
    ] };
  }
  if (p.endsWith('/ads')) {
    if (!url.searchParams.get('after')) {
      return { data: [
        { id: '9001', name: 'Ponto de luz', effective_status: 'CAMPAIGN_PAUSED', campaign_id: '111', adset: { name: '[PUB QUENTE]' },
          preview_shareable_link: 'https://fb.me/abc', creative: { thumbnail_url: 'https://scontent.xx.fbcdn.net/t1.jpg', object_type: 'VIDEO', video_id: '77' } },
        { id: '9002', name: 'Pausado sem entrega', effective_status: 'PAUSED', campaign_id: '444', adset: { name: 'X' }, creative: {} },
      ], paging: { next: 'https://graph.facebook.com/v23.0/act_465585599582830/ads?after=CUR2&access_token=TOKEN_DE_TESTE' } };
    }
    return { data: [{ id: '9003', name: 'Anúncio novo subido hoje', effective_status: 'ACTIVE', campaign_id: '333', adset: { name: 'CJ novo' },
      preview_shareable_link: 'https://fb.me/novo', creative: { image_url: 'https://scontent.xx.fbcdn.net/img.jpg', object_type: 'SHARE' } }] };
  }
  throw new Error('URL inesperada no teste: ' + u);
}

global.fetch = async (u) => ({ status: 200, json: async () => respond(u) });
const handler = require('../api/meta.js');

function run(query) {
  return new Promise((resolve) => {
    const headers = {};
    const res = { statusCode: 0, setHeader: (k, v) => { headers[k.toLowerCase()] = v; },
      end: (body) => resolve({ status: res.statusCode, headers, body: JSON.parse(body) }) };
    handler({ query, url: '/api/meta' }, res);
  });
}

(async () => {
  const { status, body } = await run({ start: '2026-10-01', end: '2026-10-29' });
  assert.strictEqual(status, 200, JSON.stringify(body));
  assert.strictEqual(body.source, 'meta');
  assert.strictEqual(windsorUsado, false, 'com token do Meta, não usa o Windsor');
  assert.strictEqual(body.account.name, 'CA - Occhio Blu');
  assert.strictEqual(body.totals.cur.spend, 535.65);
  assert.strictEqual(body.totals.cur.leads, 40);
  assert.strictEqual(body.totals.prev.purchases, 1, 'omni_purchase sem contar purchase em dobro');
  assert.strictEqual(body.totals.prev.revenue, 598);
  // Campanha ativa sem gasto aparece; pausada sem entrega não
  assert.deepStrictEqual(body.campaigns.map((c) => c.id).sort(), ['111', '333']);
  assert.strictEqual(body.campaigns.find((c) => c.id === '111').prev.leads, 4);
  // Anúncio ativo sem gasto aparece (inclusive da 2ª página); pausado sem entrega não
  assert.deepStrictEqual(body.ads.map((a) => a.id).sort(), ['9001', '9003']);
  const novo = body.ads.find((a) => a.id === '9003');
  assert.strictEqual(novo.campaign, 'Campanha nova sem gasto');
  assert.strictEqual(novo.thumb, 'https://scontent.xx.fbcdn.net/img.jpg');
  assert.strictEqual(body.ads.find((a) => a.id === '9001').format, 'video');
  assert.deepStrictEqual(body.daily[0], { date: '2026-10-19', campaign_id: '111', spend: 24.64, link_clicks: 19, leads: 14 });
  assert.ok(!JSON.stringify(body).includes('TOKEN_DE_TESTE'));

  const r1 = await run({ start: '2026-10-01', end: '2026-10-29', part: 'resumo' });
  assert.ok(r1.body.totals && !r1.body.ads);
  const r2 = await run({ start: '2026-10-01', end: '2026-10-29', part: 'anuncios' });
  assert.ok(r2.body.ads && !r2.body.totals);

  // Token inválido
  global.fetch = async () => ({ status: 400, json: async () => ({ error: { message: 'Error validating access token', code: 190 } }) });
  const bad = await run({ start: '2026-10-01', end: '2026-10-29' });
  assert.strictEqual(bad.status, 502);
  assert.ok(/expirou ou é inválido/.test(bad.body.error));

  console.log('OK: testes do modo Meta passaram');
})().catch((e) => { console.error(e); process.exit(1); });
