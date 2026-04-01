// ================================================================
// 🤖 FRANKENSTEIN BOT — AVIATOR → TELEGRAM
// Compatível com Node.js QUALQUER VERSÃO (usa https nativo)
//
// COMO USAR:
//  1. node aviator_bot_telegram.js
//  2. Ou hospede grátis em: Railway.app / Render.com / Glitch.com
//
// CONFIGURAÇÃO: edite a seção "CONFIG" abaixo
// ================================================================


// ── MÓDULOS NATIVOS (funciona em qualquer versão do Node) ────────
const https = require('https');
const { URL } = require('url');

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
    vela_grande:   999,   // DESLIGADO — use estratégia vela_100x abaixo
    vela_extrema:  9999,  // DESLIGADO
    vela_maxima:   500,   // avisa com alerta especial
    sequencia_azul: 999,  // DESLIGADO — use as estratégias abaixo
    ausencia_50x:   9999, // DESLIGADO
  },

  // 6. Estratégias de sinal
  ESTRATEGIAS: {
    // VELAS INVERTIDAS — pares com mesmo dígito
    velas_invertidas: {
      ativo:       true,   // true = ligado, false = desligado
      horas_apos:  1,      // quantas horas após o par para entrar (ex: 1 = +1h)
      intervalo:   10,     // minutos entre entradas (ex: 10 = a cada 10min)
      qtd_entradas: 4,     // quantas entradas gerar
      avisar_antes: 5,     // avisar X minutos ANTES da entrada
    },
    // VELA 100x+ — após vela grande, entrada na próxima hora
    vela_100x: {
      ativo:        true,
      mult_minima:  100,   // vela mínima para disparar (100x)
      horas_apos:   1,
      intervalo:    10,
      qtd_entradas: 4,
      avisar_antes: 5,
    },

    // 🩷 ESTRATÉGIA IA — ROSA GATILHO
    // Detecta velas ≥10x e calcula horário de entrada por algoritmo ID+segundos
    rosa_gatilho: {
      ativo:        true,
      mult_minima:  10,    // vela mínima rosa (≥10x)
      qtd_entradas: 3,     // quantas entradas gerar
      intervalo:    10,    // minutos entre entradas
      avisar_antes: 5,     // avisar X minutos antes da entrada
    },
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
  return new Promise((resolve) => {
    const body = JSON.stringify({
      chat_id:    CONFIG.CHAT_ID,
      text:       msg,
      parse_mode: parseMode,
    });
    const options = {
      hostname: 'api.telegram.org',
      path:     `/bot${CONFIG.BOT_TOKEN}/sendMessage`,
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (!json.ok) console.error('❌ Telegram:', json.description);
          else          console.log('📤 Enviado:', msg.slice(0, 60));
        } catch(e) {}
        resolve();
      });
    });
    req.on('error', e => { console.error('❌ Telegram erro:', e.message); resolve(); });
    req.setTimeout(8000, () => { req.destroy(); resolve(); });
    req.write(body);
    req.end();
  });
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
  return new Promise((resolve, reject) => {
    const ts   = (apiUrl.includes('?') ? '&' : '?') + '_=' + Date.now();
    const full = proxyUrl
      ? proxyUrl + encodeURIComponent(apiUrl + ts)
      : apiUrl + ts;

    const parsed = new URL(full);
    const mod = parsed.protocol === 'https:' ? https : http;

    const req = mod.get(full, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          if (res.statusCode !== 200) { reject(new Error('HTTP ' + res.statusCode)); return; }
          const raw   = JSON.parse(data);
          const items = Array.isArray(raw) ? raw
            : raw.items || raw.data || raw.rounds || raw.history || null;
          if (!items || !items.length) { reject(new Error('Array vazio')); return; }
          resolve(items);
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
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


// ════════════════════════════════════════════════════════
// 🎯 MOTOR DE ESTRATÉGIAS — VELAS INVERTIDAS + 100x
// ════════════════════════════════════════════════════════

// Histórico completo de velas recebidas (buffer grande)
const historicoVelas = [];

// Sinais agendados: { tipo, horario, entradas[], enviados[] }
const sinaisAgendados = [];

// Converter HH:MM ou HH:MM:SS para minutos totais do dia
function toMin(h) {
  if (!h) return -1;
  const p = h.split(':');
  return parseInt(p[0]) * 60 + parseInt(p[1] || 0);
}

// Adicionar N minutos a um horário HH:MM
function addMin(hhmm, mins) {
  const p = (hhmm || '00:00').split(':');
  let total = parseInt(p[0]) * 60 + parseInt(p[1] || 0) + mins;
  total = ((total % 1440) + 1440) % 1440;
  return String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');
}

// Horário atual HH:MM
function horaAgora() {
  return new Date().toTimeString().slice(0, 5);
}

// Verificar se dois números têm mesmo inteiro e mesmo dígito decimal
function isInvertido(n1, n2) {
  const int1 = Math.floor(n1), dec1 = Math.round((n1 - int1) * 10);
  const int2 = Math.floor(n2), dec2 = Math.round((n2 - int2) * 10);
  return int1 === int2 && dec1 === dec2 && Math.abs(n1 - n2) < 0.01;
}

// ── DETECTAR VELAS INVERTIDAS ─────────────────────────────
function detectarVelasInvertidas(vela) {
  if (!CONFIG.ESTRATEGIAS.velas_invertidas.ativo) return;
  const cfg = CONFIG.ESTRATEGIAS.velas_invertidas;

  // Procurar par nos últimos 50 candles
  for (let i = historicoVelas.length - 1; i >= Math.max(0, historicoVelas.length - 50); i--) {
    const v = historicoVelas[i];
    if (!v || v.id === vela.id) continue;
    if (isInvertido(v.mult, vela.mult)) {
      // Par encontrado!
      const _id1 = v.id > 0 ? v.id : (v.horario + v.mult);
      const _id2 = vela.id > 0 ? vela.id : (vela.horario + vela.mult);
      const chave = `inv_${_id1}_${_id2}`;
      if (sinaisAgendados.find(s => s.chave === chave)) return; // já agendado

      // Calcular entradas
      const horaBase = vela.horario.slice(0, 5);
      const entradas = [];
      for (let k = 0; k < cfg.qtd_entradas; k++) {
        entradas.push(addMin(horaBase, cfg.horas_apos * 60 + k * cfg.intervalo));
      }

      sinaisAgendados.push({
        chave,
        tipo:     'invertidas',
        vela1:    v,
        vela2:    vela,
        entradas,
        enviados: [],
        avisado:  false,
      });

      console.log(`🔄 Par invertido: ${v.mult}x + ${vela.mult}x → entradas: ${entradas.join(', ')}`);

      // Aviso imediato
      const _em2 = ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣'];
      let _msgInv = `🔄 <b>VELAS INVERTIDAS</b>\n`;
      _msgInv += `⚡ ${v.mult}x + ${vela.mult}x\n\n`;
      _msgInv += `📋 Entradas programadas:\n`;
      entradas.forEach((e, i) => { _msgInv += `${_em2[i]||i+1} ${e}\n`; });
      _msgInv += `\n⚠️ Aviso 5min antes de cada entrada\n🧟 Frankenstein Bot`;
      sendTelegram(_msgInv);
      return;
    }
  }
}

// ── DETECTAR VELA 100x ───────────────────────────────────
function detectarVela100x(vela) {
  if (!CONFIG.ESTRATEGIAS.vela_100x.ativo) return;
  const cfg = CONFIG.ESTRATEGIAS.vela_100x;
  if (vela.mult < cfg.mult_minima) return;

  const chaveKey100 = vela.id > 0 ? vela.id : (vela.horario + '_' + vela.mult);
  const chave = `v100_${chaveKey100}`;
  if (sinaisAgendados.find(s => s.chave === chave)) return;

  const horaBase = vela.horario.slice(0, 5);
  const entradas = [];
  for (let k = 0; k < cfg.qtd_entradas; k++) {
    entradas.push(addMin(horaBase, cfg.horas_apos * 60 + k * cfg.intervalo));
  }

  sinaisAgendados.push({
    chave,
    tipo:     'v100x',
    vela1:    vela,
    entradas,
    enviados: [],
    avisado:  false,
  });

  console.log(`💥 Vela ${vela.mult}x → entradas: ${entradas.join(', ')}`);
}

// ── VERIFICAR AVISOS (roda a cada tick) ──────────────────
async function verificarAvisos() {
  const agora    = horaAgora();
  const agoraMin = toMin(agora);
  const cfgInv   = CONFIG.ESTRATEGIAS.velas_invertidas;
  const cfg100   = CONFIG.ESTRATEGIAS.vela_100x;

  for (const sinal of sinaisAgendados) {
    const antes = sinal.tipo === 'invertidas'
      ? cfgInv.avisar_antes
      : sinal.tipo === 'rosa_ia'
        ? CONFIG.ESTRATEGIAS.rosa_gatilho.avisar_antes
        : cfg100.avisar_antes;

    for (let i = 0; i < sinal.entradas.length; i++) {
      const entMin    = toMin(sinal.entradas[i]);
      const avisarMin = entMin - antes;
      const chaveEnv  = `${sinal.chave}_e${i}`;

      // Já avisou esta entrada?
      if (sinal.enviados.includes(chaveEnv)) continue;

      // Está na janela de aviso? (±1 min)
      if (agoraMin >= avisarMin && agoraMin <= avisarMin + 1) {
        sinal.enviados.push(chaveEnv);

        if (sinal.tipo === 'invertidas') {
          await sendTelegram(msgVelasInvertidas(sinal, i, antes));
        } else if (sinal.tipo === 'rosa_ia') {
          await sendTelegram(msgRosaIA(sinal, i, antes));
        } else {
          await sendTelegram(msgSinal100x(sinal, i, antes));
        }
      }
    }
  }

  // Limpar sinais muito antigos (mais de 3 horas)
  const limite = agoraMin - 180;
  for (let i = sinaisAgendados.length - 1; i >= 0; i--) {
    const ultimo = toMin(sinaisAgendados[i].entradas.slice(-1)[0] || '00:00');
    if (ultimo < limite) sinaisAgendados.splice(i, 1);
  }
}

// ── MENSAGENS ─────────────────────────────────────────────
function msgVelasInvertidas(sinal, entIdx, antes) {
  const ent = sinal.entradas[entIdx];
  const emojis = ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣'];

  let msg = `🔄 <b>VELAS INVERTIDAS — SINAL!</b>\n\n`;
  msg += `📌 Par detectado:\n`;
  msg += `   ${sinal.vela1.mult}x às ${sinal.vela1.horario.slice(0,5)}\n`;
  msg += `   ${sinal.vela2.mult}x às ${sinal.vela2.horario.slice(0,5)}\n\n`;
  msg += `⏰ <b>ENTRAR EM ${antes} MINUTOS!</b>\n`;
  msg += `🎯 Entrada ${emojis[entIdx] || entIdx+1}: <b>${ent}</b>\n\n`;

  msg += `📋 Todas as entradas:\n`;
  sinal.entradas.forEach((e, i) => {
    msg += `   ${emojis[i] || i+1} ${e}${i === entIdx ? ' ← AGORA' : ''}\n`;
  });

  msg += `\n<i>🧟 Frankenstein Bot</i>`;
  return msg;
}

function msgSinal100x(sinal, entIdx, antes) {
  const ent = sinal.entradas[entIdx];
  const emojis = ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣'];

  let msg = `💥 <b>VELA ${sinal.vela1.mult}x — SINAL!</b>\n\n`;
  msg += `⚡ Vela detectada às ${sinal.vela1.horario.slice(0,5)}\n\n`;
  msg += `⏰ <b>ENTRAR EM ${antes} MINUTOS!</b>\n`;
  msg += `🎯 Entrada ${emojis[entIdx] || entIdx+1}: <b>${ent}</b>\n\n`;

  msg += `📋 Todas as entradas:\n`;
  sinal.entradas.forEach((e, i) => {
    msg += `   ${emojis[i] || i+1} ${e}${i === entIdx ? ' ← AGORA' : ''}\n`;
  });

  msg += `\n<i>🧟 Frankenstein Bot</i>`;
  return msg;
}


// ════════════════════════════════════════════════════════
// 🩷 ESTRATÉGIA IA — ROSA GATILHO
// Algoritmo: ID + segundos → calcula horário de entrada
// ════════════════════════════════════════════════════════

function calcEntradaRosa(vela) {
  // Pegar últimos 2 dígitos do ID
  const idStr = String(vela.id || '').replace(/\D/g, '');
  const ult2  = parseInt(idStr.slice(-2) || '0') || 0;

  // Horário da vela
  const partes = (vela.horario || '00:00:00').split(':');
  const hh = parseInt(partes[0] || 0);
  const mm = parseInt(partes[1] || 0);
  const ss = parseInt(partes[2] || 0);

  // Algoritmo de cálculo (mesmo do app)
  const offset = ult2 + ss;
  const diff   = 60 - mm;
  let entMin   = offset - diff;
  let entHora  = hh + 1;

  if (entMin < 0)  { entHora--; entMin += 60; }
  if (entMin >= 60){ entHora++; entMin -= 60; }
  entHora = ((entHora % 24) + 24) % 24;

  const base = String(entHora).padStart(2, '0') + ':' + String(entMin).padStart(2, '0');

  // Gerar slots de entrada
  const cfg = CONFIG.ESTRATEGIAS.rosa_gatilho;
  const entradas = [];
  for (let k = 0; k < cfg.qtd_entradas; k++) {
    entradas.push(addMin(base, k * cfg.intervalo));
  }

  return { base, entradas };
}

function detectarRosaGatilho(vela) {
  if (!CONFIG.ESTRATEGIAS.rosa_gatilho.ativo) return;
  const cfg = CONFIG.ESTRATEGIAS.rosa_gatilho;

  // Só velas rosa (≥10x)
  if (vela.mult < cfg.mult_minima) return;
  if (vela.cor !== 'rosa') return;

  // Usar horario+mult como chave se id=0
  const chaveKey = vela.id > 0 ? vela.id : (vela.horario + '_' + vela.mult);
  const chave = `rosa_${chaveKey}`;
  if (sinaisAgendados.find(s => s.chave === chave)) return;

  const { base, entradas } = calcEntradaRosa(vela);

  sinaisAgendados.push({
    chave,
    tipo:     'rosa_ia',
    vela1:    vela,
    base,
    entradas,
    enviados: [],
  });

  console.log(`🩷 Rosa IA: ${vela.mult}x → base ${base} → entradas: ${entradas.join(', ')}`);

  // Mandar aviso imediato com as entradas geradas
  const emojis = ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣'];
  let msgImediata = `🩷 <b>IA ROSA GATILHO</b>\n`;
  msgImediata += `⚡ ${vela.mult}x às ${vela.horario.slice(0,5)}\n\n`;
  msgImediata += `🧮 Base calculada: <b>${base}</b>\n\n`;
  msgImediata += `📋 Entradas programadas:\n`;
  entradas.forEach((e, i) => {
    msgImediata += `${emojis[i] || i+1} ${e}\n`;
  });
  msgImediata += `\n⚠️ Aviso chegará 5min antes de cada entrada\n`;
  msgImediata += `\n<i>🧟 Frankenstein Bot</i>`;
  sendTelegram(msgImediata);
}

function msgRosaIA(sinal, entIdx, antes) {
  const ent    = sinal.entradas[entIdx];
  const emojis = ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣'];

  let msg = `🩷 <b>IA ROSA GATILHO</b>\n`;
  msg += `⚡ ${sinal.vela1.mult}x às ${sinal.vela1.horario.slice(0,5)}\n\n`;
  msg += `🎯 <b>ENTRAR AGORA: ${ent}</b>\n\n`;
  msg += `📋 Entradas:\n`;
  sinal.entradas.forEach((e, i) => {
    const marca = i === entIdx ? ' ✅' : i < entIdx ? ' ✔' : '';
    msg += `${emojis[i] || i+1} ${e}${marca}\n`;
  });
  msg += `\n<i>🧟 Frankenstein Bot</i>`;
  return msg;
}

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
  await verificarAvisos();
}

// Render precisa de uma porta aberta — servidor HTTP simples
const http = require('http');
const PORT = process.env.PORT || 3000;

http.createServer((req, res) => {
  res.writeHead(200, {'Content-Type': 'text/plain'});
  res.end('🧟 Frankenstein Bot rodando! Velas: ' + totalVelas);
}).listen(PORT, () => {
  console.log('🌐 Servidor HTTP na porta ' + PORT);
});

// Auto-ping para evitar inatividade no Render (a cada 14 minutos)
function autoPing() {
  const url = process.env.RENDER_EXTERNAL_URL;
  if (!url) return;
  const mod = url.startsWith('https') ? require('https') : require('http');
  mod.get(url, (res) => {
    console.log('🏓 Ping próprio: ' + res.statusCode);
  }).on('error', () => {});
}
setInterval(autoPing, 14 * 60 * 1000); // a cada 14 minutos

async function main() {
  console.log('🧟 FRANKENSTEIN BOT iniciado!');
  console.log(`📡 API: ${CONFIG.API_URL}`);
  console.log(`⏱  Intervalo: ${CONFIG.INTERVAL_MS / 1000}s`);
  console.log(`📢 Chat: ${CONFIG.CHAT_ID}\n`);

  // Teste de envio — confirma que Telegram está conectado
  setTimeout(async () => {
    const agora = new Date().toTimeString().slice(0,8);
    const velaTest = { id: 99999, mult: 15.00, cor: 'rosa', horario: agora };
    console.log('🧪 Testando envio Telegram...');
    detectarRosaGatilho(velaTest);
  }, 5000);

  // Mensagem de início
  await sendTelegram(
    `🧟 <b>FRANKENSTEIN BOT</b> iniciado!\n\n`
    + `📡 Monitorando Aviator ao vivo\n`
    + `⏱ Atualização a cada ${CONFIG.INTERVAL_MS / 1000}s\n\n`
    + `<b>Estratégias ativas:</b>\n`
    + `🔄 Velas Invertidas — avisa ${CONFIG.ESTRATEGIAS.velas_invertidas.avisar_antes}min antes\n`
    + `🩷 Rosa IA ≥${CONFIG.ESTRATEGIAS.rosa_gatilho.mult_minima}x — avisa ${CONFIG.ESTRATEGIAS.rosa_gatilho.avisar_antes}min antes\n`
    + `💥 Vela 100x+ — avisa ${CONFIG.ESTRATEGIAS.vela_100x.avisar_antes}min antes\n\n`
    + `✅ Bot rodando 24h no Render!`
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
