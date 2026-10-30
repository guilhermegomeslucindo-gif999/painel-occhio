// Testa a função api/meta.js com respostas simuladas do Windsor.ai (sem rede).
// Rode com: npm test
const assert = require('assert');

process.env.WINDSOR_API_KEY = 'CHAVE_DE_TESTE';
process.env.META_AD_ACCOUNT_ID = 'act_465585599582830';

const calls = [];

function respond(u) {
  const url = new URL(u);
  assert.strictEqual(url.origin + url.pathname, 'https://connectors.windsor.ai/facebook');
  assert.strictEqual(url.searchParams.get('select_accounts'), '465585599582830');
  assert.strictEqual(url.searchParams.get('refresh_interval'), null, 'sem a variável, não manda intervalo (o teste grátis recusa)');
  const f = url.searchParams.get('fields').split(',');
  const prev = url.searchParams.get('date_from') < '2026-10-01';
  calls.push({ fields: f, from: url.searchParams.get('date_from'), to: url.searchParams.get('date_to') });

  if (f.includes('date')) {
    return { data: [
      { date: '2026-10-19', campaign_id: '111', spend: 24.64, actions_link_click: 19, actions_onsite_conversion_messaging_conversation_started_7d: 14, actions_lead: null },
      { date: '2026-10-23', campaign_id: '222', spend: 13.77, actions_link_click: 26, actions_onsite_conversion_messaging_conversation_started_7d: null, actions_lead: null },
    ] };
  }
  if (f.includes('ad_id')) {
    return { data: [
      { campaign_id: '111', campaign: 'Vendas WPP', adset_id: '5', adset_name: '[PUB QUENTE]', ad_id: '9001', ad_name: 'Ponto de luz',
        effective_status: 'CAMPAIGN_PAUSED', object_type: 'VIDEO', thumbnail_url: 'https://scontent.xx.fbcdn.net/t1.jpg', ad_preview_shareable_link: 'https://fb.me/abc',
        spend: 94.78, impressions: 2072, clicks: 81, actions_link_click: 45, actions_onsite_conversion_messaging_conversation_started_7d: 21, actions_lead: 0 },
      { campaign_id: '333', campaign: 'Campanha nova', adset_id: '6', adset_name: 'CJ novo', ad_id: '9003', ad_name: 'Anúncio novo',
        effective_status: 'ACTIVE', object_type: 'SHARE', thumbnail_url: 'https://scontent.xx.fbcdn.net/t3.jpg', ad_preview_shareable_link: 'https://fb.me/novo',
        spend: 1.5, impressions: 30, clicks: 1, actions_link_click: 1, actions_onsite_conversion_messaging_conversation_started_7d: null, actions_lead: null },
    ] };
  }
  if (f.includes('campaign_id')) {
    return { data: prev
      ? [{ campaign_id: '111', spend: 100, reach: 1000, impressions: 2000, clicks: 50, actions_link_click: 40, actions_lead: 4 }]
      : [
        { campaign_id: '111', campaign: 'Vendas WPP', campaign_objective: 'OUTCOME_SALES', campaign_effective_status: 'PAUSED',
          spend: 139.37, reach: 2339, impressions: 2979, clicks: 116, actions_link_click: 66, actions_onsite_conversion_messaging_conversation_started_7d: 36 },
        { campaign_id: '333', campaign: 'Campanha nova', campaign_objective: 'OUTCOME_SALES', campaign_effective_status: 'ACTIVE',
          spend: 1.5, reach: 28, impressions: 30, clicks: 1, actions_link_click: 1, actions_omni_purchase: 1, action_values_omni_purchase: 890 },
      ] };
  }
  return { data: [prev
    ? { account_name: 'CA - Occhio Blu', spend: 1326.05, reach: 6012, impressions: 19940, clicks: 1113, actions_link_click: 827,
        actions_onsite_conversion_messaging_conversation_started_7d: 20, actions_lead: null, actions_omni_purchase: 1, action_values_omni_purchase: 598 }
    : { account_name: 'CA - Occhio Blu', account_currency: 'BRL', spend: 535.65, reach: 8806, impressions: 18758, clicks: 498, actions_link_click: 406,
        actions_onsite_conversion_messaging_conversation_started_7d: 40, actions_lead: null, actions_omni_purchase: null, action_values_omni_purchase: null }] };
}

global.fetch = async (u) => ({ status: 200, json: async () => respond(u) });

const handler = require('../api/meta.js');

function run(query) {
  return new Promise((resolve) => {
    const headers = {};
    const res = {
      statusCode: 0,
      setHeader: (k, v) => { headers[k.toLowerCase()] = v; },
      end: (body) => resolve({ status: res.statusCode, headers, body: JSON.parse(body) }),
    };
    handler({ query, url: '/api/meta' }, res);
  });
}

(async () => {
  const { status, headers, body } = await run({ start: '2026-10-01', end: '2026-10-29' });
  assert.strictEqual(status, 200, JSON.stringify(body));
  assert.strictEqual(headers['cache-control'], 's-maxage=900, stale-while-revalidate=86400');
  assert.strictEqual(calls.length, 6);

  // Período anterior: mesmo número de dias, logo antes
  assert.deepStrictEqual(body.period, { start: '2026-10-01', end: '2026-10-29', prev_start: '2026-09-02', prev_end: '2026-09-30' });
  assert.ok(calls.some((c) => c.from === '2026-09-02' && c.to === '2026-09-30'));
  assert.strictEqual(body.account.id, '465585599582830');
  assert.strictEqual(body.account.name, 'CA - Occhio Blu');

  // Totais (os mesmos números do painel no Claude)
  assert.strictEqual(body.totals.cur.spend, 535.65);
  assert.strictEqual(body.totals.cur.leads, 40);
  assert.strictEqual(body.totals.cur.link_clicks, 406);
  assert.strictEqual(body.totals.cur.purchases, 0);
  assert.strictEqual(body.totals.prev.purchases, 1);
  assert.strictEqual(body.totals.prev.revenue, 598);

  // Campanha nova aparece sozinha, com venda puxada automaticamente
  const nova = body.campaigns.find((c) => c.id === '333');
  assert.ok(nova, 'campanha nova deve aparecer');
  assert.strictEqual(nova.status, 'ACTIVE');
  assert.strictEqual(nova.cur.purchases, 1);
  assert.strictEqual(nova.cur.revenue, 890);
  assert.strictEqual(body.campaigns.find((c) => c.id === '111').prev.leads, 4);

  // Anúncios com capa e formato
  assert.strictEqual(body.ads.length, 2);
  const v = body.ads.find((a) => a.id === '9001');
  assert.strictEqual(v.format, 'video');
  assert.strictEqual(v.thumb, 'https://scontent.xx.fbcdn.net/t1.jpg');
  assert.strictEqual(v.cur.leads, 21);
  const novo = body.ads.find((a) => a.id === '9003');
  assert.strictEqual(novo.format, 'image');
  assert.strictEqual(novo.status, 'ACTIVE');
  assert.strictEqual(novo.campaign, 'Campanha nova');

  // Diário
  assert.deepStrictEqual(body.daily[0], { date: '2026-10-19', campaign_id: '111', spend: 24.64, link_clicks: 19, leads: 14 });

  // A chave nunca vai na resposta
  assert.ok(!JSON.stringify(body).includes('CHAVE_DE_TESTE'));

  // Partes separadas: resumo (5 consultas) e anúncios (1 consulta)
  calls.length = 0;
  const r1 = await run({ start: '2026-10-01', end: '2026-10-29', part: 'resumo' });
  assert.strictEqual(r1.status, 200);
  assert.strictEqual(calls.length, 5);
  assert.ok(r1.body.totals && r1.body.campaigns && r1.body.daily && !r1.body.ads);
  assert.strictEqual(r1.body.totals.cur.spend, 535.65);
  calls.length = 0;
  const r2 = await run({ start: '2026-10-01', end: '2026-10-29', part: 'anuncios' });
  assert.strictEqual(r2.status, 200);
  assert.strictEqual(calls.length, 1);
  assert.ok(r2.body.ads && !r2.body.totals && !r2.body.campaigns);
  assert.strictEqual(r2.body.ads.length, 2);

  // Validações
  assert.strictEqual((await run({ start: '2026-10-29', end: '2026-10-01' })).status, 400);
  assert.strictEqual((await run({ start: '2024-01-01', end: '2026-10-01' })).status, 400);
  assert.strictEqual((await run({ start: '2026-10-01', end: '2026-10-29', fresh: '1' })).headers['cache-control'], 'no-store');

  // Chave errada
  global.fetch = async () => ({ status: 401, json: async () => ({ error: { code: 'authentication_error', message: 'Invalid API key provided' } }) });
  const bad = await run({ start: '2026-10-01', end: '2026-10-29' });
  assert.strictEqual(bad.status, 502);
  assert.ok(/chave do Windsor/.test(bad.body.error));

  // Chave errada, no formato que o Windsor devolve de verdade (HTTP 400, erro em texto)
  global.fetch = async () => ({ status: 400, json: async () => ({ error: 'Please check the API key used: teste', code: 'user_error' }) });
  const bad2 = await run({ start: '2026-10-01', end: '2026-10-29' });
  assert.strictEqual(bad2.status, 502);
  assert.ok(/chave do Windsor/.test(bad2.body.error), bad2.body.error);

  // Sem chave
  delete process.env.WINDSOR_API_KEY;
  const none = await run({});
  assert.strictEqual(none.status, 500);
  assert.ok(/WINDSOR_API_KEY/.test(none.body.error));

  console.log('OK: todos os testes passaram');
})().catch((e) => { console.error(e); process.exit(1); });
