// ================================================================
// 🤖 FRANKENSTEIN BOT — AVIATOR → TELEGRAM
// Node.js · Sem dependências extras (usa fetch nativo do Node 18+)
//
// COMO USAR:
//  1. node aviator_bot_telegram.js
//  2. Ou hospede grátis em: Railway.app / Render.com / Glitch.com
//
// CONFIGURAÇÃO: edite a seção "CONFIG" abaixo
// ================================================================


// ── CONFIG ───────────────────────────────────────────────────────

const CONFIG = {
  // 1. Seu token do BotFather (@BotFather no Telegram)
  BOT_TOKEN: '8797544306:AAFNqduaGD0VWBb5q2AkiN4Qc7cz9J0lzOA',

  // 2. ID do chat/grupo/canal onde enviar
  //    Para grupo: ex  -1001234567890
  //    Para canal: ex  @meucanalAviator
  //    Para você mesmo: seu user ID numérico
  CHAT_ID: '-5172041508',

  // 3. URL da API do Aviator
  API_URL: 'https://app.oficialmasteraviator.com/api/historico.php?limit=500',

  // 4. Intervalo de verificação (ms)
  INTERVAL_MS: 10_000,   // 10 segundos

  // 5. Alertas — edite os gatilhos abaixo
  ALERTAS: {
    vela_grande:   50,    // avisa quando vela ≥ esse valor
    vela_extrema:  100,   // avisa com emoji diferente
    vela_maxima:   500,   // avisa com alerta especial
    sequencia_azul: 5,    // avisa quando X velas azuis seguidas (≥4x)
    ausencia_50x:   50,   // avisa quando não sai 50x+ há X rodadas
  },

  // 6. Silenciar alertas repetidos (segundos)
  COOLDOWN_S: 60,
};


// ── ESTADO ───────────────────────────────────────────────────────

let lastId       = 0;
let totalVelas   = 0;
let semVelaGrande= 0;   // contador de rodadas sem ≥50x
let ultimoAlerta = {};   // { tipo: timestamp } para cooldown
let timer        = null;
let proxyAtivo   = null;
let falhas       = 0;

const PROXIES = [
  { label: 'allorigins', url: 'https://api.allorigins.win/raw?url='      },
  { label: 'corsproxy',  url: 'https://corsproxy.io/?'                   },
  { label: 'cors.eu',    url: 'https://cors.eu.org/'                     },
  { label: 'codetabs',   url: 'https://api.codetabs.com/v1/proxy?quest=' },
  { label: 'direto',     url: ''                                          },
];


// ── TELEGRAM ─────────────────────────────────────────────────────

async function sendTelegram(msg, parseMode = 'HTML') {
  const url = `https://api.telegram.org/bot${CONFIG.BOT_TOKEN}/sendMessage`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id:    CONFIG.CHAT_ID,
        text:       msg,
        parse_mode: parseMode,
      }),
      signal: AbortSignal.timeout(8000),
    });
    const data = await res.json();
    if (!data.ok) console.error('❌ Telegram erro:', data.description);
    else          console.log('📤 Mensagem enviada:', msg.slice(0, 60));
  } catch (e) {
    console.error('❌ Falha ao enviar Telegram:', e.message);
  }
}

function cooldownOk(tipo) {
  const agora = Date.now();
  const ult   = ultimoAlerta[tipo] || 0;
  if (agora - ult < CONFIG.COOLDOWN_S * 1000) return false;
  ultimoAlerta[tipo] = agora;
  return true;
}


// ── FETCH COM PROXY ───────────────────────────────────────────────

async function tryFetch(proxyUrl, apiUrl) {
  const ts   = (apiUrl.includes('?') ? '&' : '?') + '_=' + Date.now();
  const full = proxyUrl
    ? proxyUrl + encodeURIComponent(apiUrl + ts)
    : apiUrl + ts;

  const res = await fetch(full, {
    cache: 'no-store',
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) throw new Error('HTTP ' + res.status);
  const raw   = await res.json();
  const items = Array.isArray(raw) ? raw
    : raw.items || raw.data || raw.rounds || raw.history || null;

  if (!items?.length) throw new Error('Array vazio');
  return items;
}

async function fetchData() {
  if (proxyAtivo) {
    try {
      const items = await tryFetch(proxyAtivo.url, CONFIG.API_URL);
      falhas = 0;
      return items;
    } catch { proxyAtivo = null; }
  }

  for (const p of PROXIES) {
    try {
      const items = await tryFetch(p.url, CONFIG.API_URL);
      proxyAtivo = p;
      falhas = 0;
      console.log(`✅ Conectado via ${p.label} (${items.length} velas)`);
      return items;
    } catch { /* silencioso */ }
  }

  falhas++;
  console.error(`⚠️ Falha ${falhas}/3 — sem conexão`);
  if (falhas >= 3) {
    console.error('❌ API inacessível. Tentando novamente em 60s...');
    await sendTelegram('⚠️ <b>FRANKENSTEIN BOT</b>\n\nSem conexão com a API do Aviator.\nTentando reconectar...');
    await new Promise(r => setTimeout(r, 60_000));
    falhas = 0;
    proxyAtivo = null;
  }
  return null;
}


// ── NORMALIZAR VELA ───────────────────────────────────────────────

function normalizar(r) {
  const mult = parseFloat(
    r.mult || r.multiplier || r.value || r.crash || r.result || r.coef || 0
  );
  if (isNaN(mult) || mult < 1) return null;

  const id = parseInt(r.id || r.round_id || r.game_id || r.roundId || 0);

  // Horário
  let horario = '';
  for (const v of [r.horario, r.time, r.hora, r.created_at, r.timestamp]) {
    if (!v) continue;
    const s = String(v).trim();
    const num = Number(s);
    if (!isNaN(num) && num > 1e9) {
      horario = new Date(num > 1e12 ? num : num * 1000).toTimeString().slice(0, 8);
      break;
    }
    if (s.includes('T')) { horario = s.split('T')[1].slice(0, 8); break; }
    if (/^\d{1,2}:\d{2}/.test(s)) { horario = s.slice(0, 8); break; }
  }

  const cor = mult >= 10 ? 'rosa' : mult >= 2 ? 'roxo' : 'azul';

  return { id, mult: Math.round(mult * 100) / 100, cor, horario };
}


// ── GERAR MENSAGEM DE ALERTA ──────────────────────────────────────

function corEmoji(num) {
  if (num >= 1000) return '🔴';
  if (num >= 500)  return '🟠';
  if (num >= 100)  return '🟡';
  if (num >= 50)   return '🩷';
  if (num >= 10)   return '🔵';
  if (num >= 2)    return '🟣';
  return '⚪';
}

function msgVelaGrande(vela) {
  const emoji = vela.mult >= 500 ? '🚀🚀🚀' :
                vela.mult >= 100 ? '🔥🔥' :
                vela.mult >= 50  ? '🔥' : '⭐';

  return `${emoji} <b>VELA ${vela.mult}x</b> ${corEmoji(vela.mult)}\n`
    + `⏰ ${vela.horario}\n`
    + `📊 Total processado: ${totalVelas} velas\n`
    + `\n<i>🧟 Frankenstein Aviator</i>`;
}

function msgAusencia(rodadas) {
  return `⚠️ <b>AUSÊNCIA DETECTADA</b>\n\n`
    + `Já são <b>${rodadas} rodadas</b> sem vela ≥50x\n`
    + `📈 Probabilidade de saída aumentando!\n`
    + `\n<i>🧟 Frankenstein Aviator</i>`;
}

function msgSequenciaAzul(qtd) {
  return `🔵🔵🔵 <b>SEQUÊNCIA AZUL!</b>\n\n`
    + `<b>${qtd} velas azuis</b> consecutivas (todas ≤4x)\n`
    + `🎯 Atenção para possível vela grande!\n`
    + `\n<i>🧟 Frankenstein Aviator</i>`;
}


// ── PROCESSAR VELAS ───────────────────────────────────────────────

// Buffer de últimas velas para detectar sequências
const buffer = [];

async function processarVelas(rawItems) {
  const candles = rawItems
    .map(normalizar)
    .filter(Boolean)
    .sort((a, b) => a.id - b.id);

  const novas = candles.filter(c => c.id > lastId);
  if (!novas.length) return;

  lastId = Math.max(...candles.map(c => c.id));
  totalVelas += novas.length;

  for (const vela of novas) {
    // Adicionar no buffer (mantém últimas 20)
    buffer.push(vela);
    if (buffer.length > 20) buffer.shift();

    const num = vela.mult;

    // Log local sempre
    const emoji = corEmoji(num);
    console.log(`${emoji} ${num}x  ${vela.horario}  [${vela.cor}]`);

    // ── ALERTA: vela grande ──────────────────────────────────
    if (num >= CONFIG.ALERTAS.vela_grande) {
      const tipo = num >= CONFIG.ALERTAS.vela_maxima  ? 'maxima'  :
                   num >= CONFIG.ALERTAS.vela_extrema ? 'extrema' : 'grande';
      if (cooldownOk(tipo)) {
        await sendTelegram(msgVelaGrande(vela));
      }
      semVelaGrande = 0;  // resetar contador
    } else {
      semVelaGrande++;
    }

    // ── ALERTA: ausência de vela grande ─────────────────────
    if (semVelaGrande > 0 && semVelaGrande % CONFIG.ALERTAS.ausencia_50x === 0) {
      if (cooldownOk('ausencia_' + semVelaGrande)) {
        await sendTelegram(msgAusencia(semVelaGrande));
      }
    }
  }

  // ── ALERTA: sequência de velas azuis (≤4x) ──────────────
  const seqAzul = buffer.reduceRight((acc, v) => {
    if (acc.parou) return acc;
    if (v.mult <= 4) acc.count++;
    else acc.parou = true;
    return acc;
  }, { count: 0, parou: false }).count;

  if (seqAzul >= CONFIG.ALERTAS.sequencia_azul) {
    if (cooldownOk('seq_azul_' + seqAzul)) {
      await sendTelegram(msgSequenciaAzul(seqAzul));
    }
  }
}


// ── LOOP PRINCIPAL ────────────────────────────────────────────────

async function tick() {
  const items = await fetchData();
  if (items) await processarVelas(items);
}

async function main() {
  console.log('🧟 FRANKENSTEIN BOT iniciado!');
  console.log(`📡 API: ${CONFIG.API_URL}`);
  console.log(`⏱  Intervalo: ${CONFIG.INTERVAL_MS / 1000}s`);
  console.log(`📢 Chat: ${CONFIG.CHAT_ID}\n`);

  // Mensagem de início
  await sendTelegram(
    `🧟 <b>FRANKENSTEIN BOT</b> iniciado!\n\n`
    + `📡 Monitorando Aviator ao vivo\n`
    + `⏱ Atualização a cada ${CONFIG.INTERVAL_MS / 1000}s\n\n`
    + `<b>Alertas configurados:</b>\n`
    + `🔥 Vela grande: ≥${CONFIG.ALERTAS.vela_grande}x\n`
    + `🚀 Vela extrema: ≥${CONFIG.ALERTAS.vela_extrema}x\n`
    + `🔵 Sequência azul: ${CONFIG.ALERTAS.sequencia_azul}+ seguidas\n`
    + `⚠️ Ausência 50x: ${CONFIG.ALERTAS.ausencia_50x}+ rodadas`
  );

  // Primeira execução
  await tick();

  // Loop
  timer = setInterval(tick, CONFIG.INTERVAL_MS);
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n⏹ Parando bot...');
  clearInterval(timer);
  await sendTelegram('⏹ <b>FRANKENSTEIN BOT</b> parado.');
  process.exit(0);
});

main().catch(console.error);


// ================================================================
// HOSPEDAGEM GRATUITA — PASSO A PASSO:
//
// ── RAILWAY.APP (recomendado) ────────────────────────────────────
//  1. Crie conta em railway.app
//  2. New Project → Deploy from GitHub
//  3. Crie um repo com este arquivo + package.json abaixo
//  4. Adicione variáveis de ambiente:
//     BOT_TOKEN = seu token
//     CHAT_ID   = seu chat id
//  5. Pronto — roda 24/7 grátis!
//
// package.json mínimo:
//  {
//    "name": "frankenstein-bot",
//    "version": "1.0.0",
//    "main": "aviator_bot_telegram.js",
//    "engines": { "node": ">=18" },
//    "scripts": { "start": "node aviator_bot_telegram.js" }
//  }
//
// ── RENDER.COM (alternativa) ─────────────────────────────────────
//  1. New Web Service → conectar GitHub
//  2. Build: npm install
//  3. Start: node aviator_bot_telegram.js
//  4. Adicionar env vars: BOT_TOKEN e CHAT_ID
//
// ── LOCAL (teste) ────────────────────────────────────────────────
//  node --version   (precisa ser ≥18)
//  node aviator_bot_telegram.js
// ================================================================
