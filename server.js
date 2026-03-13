const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const session = require('express-session');

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const UPLOADS_DIR = path.join(ROOT, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'siniestros.json');

for (const dir of [DATA_DIR, UPLOADS_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, '[]', 'utf8');

app.use(cors());
app.use(express.json({ limit: '30mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: 'gomez-prieto-login-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 24 * 7 }
}));

const LOGIN_USER = 'Perito';
const LOGIN_PASSWORD = 'Carletes2009';

function isAuthenticated(req) {
  return !!(req.session && req.session.authenticated);
}
function requireAuth(req, res, next) {
  if (isAuthenticated(req)) return next();
  if (req.path.startsWith('/api') || req.path.startsWith('/uploads') || req.path.endsWith('.js') || req.path.endsWith('.css')) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  return res.redirect('/login');
}

const loginPageHtml = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Acceso - Gómez Prieto SL</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:Inter,Arial,sans-serif;background:radial-gradient(circle at top,#183960 0%,#08111d 52%);color:#f5fbff}*{box-sizing:border-box}.card{width:min(92vw,430px);padding:28px;border-radius:28px;background:rgba(11,19,31,.78);border:1px solid rgba(255,255,255,.12);box-shadow:0 18px 60px rgba(0,0,0,.36);backdrop-filter:blur(18px)}h1{margin:0 0 6px;font-size:30px}.mini{margin:0 0 4px;color:#9fb2c9;font-size:12px;letter-spacing:.15em;text-transform:uppercase}.field{display:grid;gap:8px;margin-top:14px}.input{width:100%;border-radius:18px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.07);color:#fff;padding:14px 16px;outline:none}button{margin-top:18px;width:100%;border:none;border-radius:18px;padding:14px 16px;font-weight:800;cursor:pointer;background:linear-gradient(135deg,#d3eeff,#1f96ff);color:#05121d}.help{margin-top:10px;color:#9fb2c9;font-size:13px}.err{min-height:20px;margin-top:10px;color:#ffb8b8;font-size:13px}.brand{display:flex;gap:12px;align-items:center;margin-bottom:16px}.icon{width:56px;height:56px;border-radius:18px;display:grid;place-items:center;font-weight:800;font-size:18px;color:#04131f;background:linear-gradient(135deg,#d3eeff,#78c5ff)}</style>
</head>
<body>
<div class="card">
  <div class="brand"><div class="icon">GP</div><div><p class="mini">Portal interno</p><h1>Gómez Prieto SL</h1></div></div>
  <form id="loginForm">
    <div class="field"><label>Usuario</label><input class="input" id="username" autocomplete="username" required></div>
    <div class="field"><label>Contraseña</label><input class="input" id="password" type="password" autocomplete="current-password" required></div>
    <button type="submit">Entrar</button>
    <div id="error" class="err"></div>
  </form>
  <div class="help">Acceso privado al portal de peritos.</div>
</div>
<script>
document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const res = await fetch('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: document.getElementById('username').value, password: document.getElementById('password').value })
  });
  const data = await res.json();
  if (!res.ok) { document.getElementById('error').textContent = data.error || 'Error de acceso'; return; }
  location.href = '/';
});
</script>
</body>
</html>`;

app.get('/login', (req, res) => {
  if (isAuthenticated(req)) return res.redirect('/');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(loginPageHtml);
});
app.post('/auth/login', (req, res) => {
  const username = cleanText(req.body.username);
  const password = String(req.body.password || '');
  if (username === LOGIN_USER && password === LOGIN_PASSWORD) {
    req.session.authenticated = true;
    return res.json({ ok: true });
  }
  return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
});
app.post('/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.use('/uploads', requireAuth, express.static(UPLOADS_DIR));
app.use(requireAuth, express.static(path.join(ROOT, 'public')));

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '') || '.bin';
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext}`);
  }
});

const ALLOWED_FILE_RE = /\.(jpg|jpeg|png|webp|heic|pdf|doc|docx|xls|xlsx|txt)$/i;
const upload = multer({
  storage,
  limits: { files: 60, fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const isAudioField = file.fieldname === 'audio';
    if (isAudioField) {
      const ok = file.mimetype.startsWith('audio/') || /\.(webm|mp3|wav|m4a|ogg)$/i.test(file.originalname || '');
      return cb(ok ? null : new Error('Formato de audio no permitido'), ok);
    }
    const ok = file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf' || ALLOWED_FILE_RE.test(file.originalname || '');
    cb(ok ? null : new Error('Formato de archivo no permitido'), ok);
  }
});

const ACTIVIDADES = [
  'Albañilería', 'Antenista', 'Carpintería de madera', 'Carpintería aluminio', 'Cerrajería',
  'Cristalería', 'Desescombro', 'Escayola', 'Fontanería', 'Instalaciones eléctricas',
  'Jardinería', 'Limpieza', 'Mármoles', 'Mensajería', 'Moqueta', 'Papel pintado', 'Parquet',
  'Persianas', 'Pintura', 'Pocería y atrancos', 'Pulido y abrillantado de suelos', 'PVC',
  'Reposición aparatos eléctricos', 'Reposición cerámica', 'Reposición sanitarios',
  'Seguridad', 'Telefonía', 'Tejados', 'Toldos', 'Vitrocerámica', 'Aire acondicionado'
];
const CONCEPTOS = ['Reparación estética', 'Reposición', 'Desplazamiento', 'Mano de obra', 'Materiales'];

function readDb() { try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch { return []; } }
function writeDb(data) { fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8'); }
function sortNewest(items) { return [...items].sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt)); }
function cleanText(value) { return String(value || '').replace(/\s+/g, ' ').trim(); }
function parseNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const str = String(value).replace(/€/g, '').replace(/\./g, '').replace(/,/g, '.').replace(/\s+/g, '').trim();
  const num = Number(str);
  return Number.isFinite(num) ? num : null;
}
function formatMoneyEs(value) {
  const num = Number(value || 0);
  return num.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function computeContinente(surface, insured) {
  const metros = parseNumber(surface) || 0;
  const suma = parseNumber(insured) || 0;
  const calculado = metros * 950;
  let causa = 'NO CONSTA EN LA NOTA DEL PERITO';
  if (metros && suma) {
    const ratio = Math.abs(calculado - suma) / Math.max(suma, 1);
    if (ratio <= 0.08) causa = 'A valor real';
    else if (calculado > suma) causa = 'Infraseguro';
    else causa = 'Sobreseguro';
  }
  return { calculado, causa };
}
function emptyToNoConsta(value) { const text = cleanText(value); return text || 'NO CONSTA EN LA NOTA DEL PERITO'; }
function safeFileName(name) { return String(name || 'archivo').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim(); }
function isImageName(name='', mimetype='') { return mimetype.startsWith('image/') || /\.(jpg|jpeg|png|webp|heic)$/i.test(name); }
function fileKind(file={}) {
  if (isImageName(file.name || '', file.mimetype || '')) return 'image';
  if ((file.mimetype || '') === 'application/pdf' || /\.pdf$/i.test(file.name || '')) return 'pdf';
  return 'file';
}
function normalizeArchivos(list = []) {
  return (Array.isArray(list) ? list : []).filter(Boolean).slice(0, 30).map(f => ({
    url: cleanText(f.url),
    name: cleanText(f.name),
    mimetype: cleanText(f.mimetype),
    kind: f.kind || fileKind(f)
  }));
}
function photosFromArchivos(archivos = []) {
  return normalizeArchivos(archivos).filter(f => f.kind === 'image').map(f => ({ url: f.url, name: f.name, mimetype: f.mimetype, kind: 'image' }));
}
function fileRecord(file) {
  return { url: `/uploads/${file.filename}`, name: file.originalname, mimetype: file.mimetype || '', kind: fileKind({ name: file.originalname, mimetype: file.mimetype || '' }) };
}
function mergeArchivos(current = [], incoming = []) {
  const byKey = new Map();
  [...normalizeArchivos(current), ...normalizeArchivos(incoming)].forEach(item => byKey.set(`${item.url}::${item.name}`, item));
  return [...byKey.values()].slice(0, 30);
}
function downloadNameForCase(item, suffix, ext) {
  const base = safeFileName(item.numeroSiniestro || item.id || 'siniestro').replace(/\s+/g, '-');
  return `${base}-${suffix}.${ext}`;
}

function normalizeCaseBody(body, oldItem = {}) {
  const merged = { ...oldItem, ...body };
  const contenidoSuma = cleanText(merged.contenidoSuma);
  const superficieConstruida = cleanText(merged.superficieConstruida);
  const continenteSuma = cleanText(merged.continenteSuma);
  const continenteCalc = computeContinente(superficieConstruida, continenteSuma);
  const archivos = normalizeArchivos(merged.archivos || oldItem.archivos || merged.fotos || oldItem.fotos || []);

  return {
    id: merged.id || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    numeroSiniestro: cleanText(merged.numeroSiniestro), numeroPoliza: cleanText(merged.numeroPoliza), ramo: cleanText(merged.ramo), modalidad: cleanText(merged.modalidad),
    situacionRiesgo: cleanText(merged.situacionRiesgo), asegurado: cleanText(merged.asegurado), fechaSiniestro: cleanText(merged.fechaSiniestro), tipoSiniestro: cleanText(merged.tipoSiniestro),
    causaSiniestro: cleanText(merged.causaSiniestro), actividadRiesgo: cleanText(merged.actividadRiesgo), regimen: cleanText(merged.regimen), tipoRiesgo: cleanText(merged.tipoRiesgo),
    uso: cleanText(merged.uso), superficieConstruida, garajeMetros: cleanText(merged.garajeMetros), muroVallas: cleanText(merged.muroVallas), localizacion: cleanText(merged.localizacion),
    anoConstruccion: cleanText(merged.anoConstruccion), materialesCombustibles: cleanText(merged.materialesCombustibles), protecciones: cleanText(merged.protecciones),
    lugarSiniestro: cleanText(merged.lugarSiniestro), origenAcceso: cleanText(merged.origenAcceso), lugarEstancia: cleanText(merged.lugarEstancia), averiaReparada: cleanText(merged.averiaReparada),
    existeTercero: cleanText(merged.existeTercero), instalacionesMalEstado: cleanText(merged.instalacionesMalEstado), indicarInstalacion: cleanText(merged.indicarInstalacion),
    existioForzamiento: cleanText(merged.existioForzamiento), elementoForzado: cleanText(merged.elementoForzado), personasInterior: cleanText(merged.personasInterior),
    seguridadesAccionadas: cleanText(merged.seguridadesAccionadas), precipitacion: cleanText(merged.precipitacion), velocidadViento: cleanText(merged.velocidadViento),
    masDanosZona: cleanText(merged.masDanosZona), siniestroConsorciable: cleanText(merged.siniestroConsorciable), tipoDanos: cleanText(merged.tipoDanos), ambitoSiniestro: cleanText(merged.ambitoSiniestro),
    otrasCircunstancias: cleanText(merged.otrasCircunstancias), contenidoSuma, contenidoValorReal: contenidoSuma || '', contenidoValorNuevo: contenidoSuma || '', contenidoCausa: contenidoSuma ? 'A valor real' : '',
    continenteSuma, continenteValorReal: continenteSuma || '', continenteValorNuevo: continenteSuma || '', continenteCalculado: continenteCalc.calculado ? formatMoneyEs(continenteCalc.calculado) : '',
    continenteCausa: continenteCalc.causa, propuesta: cleanText(merged.propuesta), tipoRol: cleanText(merged.tipoRol), actividad: cleanText(merged.actividad), conceptos: cleanText(merged.conceptos),
    codigos: cleanText(merged.codigos), transcript: cleanText(merged.transcript), observacionesBreves: cleanText(merged.observacionesBreves), estado: cleanText(merged.estado) || 'Pendiente',
    audioUrl: cleanText(merged.audioUrl), archivos, fotos: photosFromArchivos(archivos),
    createdAt: merged.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString()
  };
}

function firstMatch(text, patterns) { for (const pattern of patterns) { const match = text.match(pattern); if (match && match[1]) return cleanText(match[1]); } return ''; }
function detectOne(text, candidates) { const lower = text.toLowerCase(); return candidates.find(item => lower.includes(item.toLowerCase())) || ''; }
function detectCodeList(text) { const matches = text.match(/\b(?:c[óo]digos?\s*)?(\d{3,4})\b/gi) || []; const normalized = matches.map(m => (m.match(/(\d{3,4})/) || [,''])[1]).filter(Boolean); const uniq = [...new Set(normalized)]; return uniq.slice(0, 10).join(', '); }
function detectSentence(text, words) { const bits = text.split(/(?<=[\.!?])\s+/); const found = bits.find(s => words.some(w => s.toLowerCase().includes(w.toLowerCase()))); return cleanText(found || ''); }
function detectAddress(text) { return firstMatch(text, [/(?:direcci[oó]n|situaci[oó]n(?: del riesgo)?|lugar del siniestro)\s*:?\s*(.+?)(?:\.|\n|$)/i, /(?:en|ubicado en)\s+([A-ZÁÉÍÓÚÑa-záéíóúñ0-9,ºª\- ]{12,}?)(?:\.|\n|$)/]); }
function inferLocalizacion(text) { const lower = text.toLowerCase(); if (lower.includes('fuera del núcleo') || lower.includes('no se encuentra dentro de un núcleo')) return 'No, no se encuentra dentro de un núcleo'; if (lower.includes('dentro del núcleo') || lower.includes('núcleo urbano') || lower.includes('se encuentra dentro de un núcleo')) return 'Sí, se encuentra dentro de un núcleo'; return ''; }
function summarizeTranscript(text) {
  const raw = cleanText(text); if (!raw) return '';
  const s1 = detectSentence(raw, ['daño', 'afecta', 'afectado', 'filtr', 'lluv', 'viento', 'agua', 'rotura', 'humedad']);
  const s2 = detectSentence(raw, ['cubre', 'cobertura', 'procede', 'indemn', 'repar', 'informe']);
  const s3 = detectSentence(raw, ['metros', 'm2', 'm²', 'continente', 'contenido', 'valor']);
  return [s1, s2, s3].filter(Boolean).join(' ').trim() || raw;
}
function autofillFromTranscript(caseItem) {
  const transcript = cleanText(caseItem.transcript);
  if (!transcript) return normalizeCaseBody(caseItem);
  const t = ` ${transcript} `;
  const partial = { ...caseItem };
  partial.numeroSiniestro ||= firstMatch(t, [/expediente\s*(?:n[ºo.]*)?\s*([\d.\/-]+)/i, /siniestro\s*(?:n[ºo.]*)?\s*([\d.\/-]+)/i]);
  partial.numeroPoliza ||= firstMatch(t, [/p[oó]liza\s*(?:n[ºo.]*)?\s*([\w.\/-]+)/i]);
  partial.situacionRiesgo ||= detectAddress(t);
  partial.localizacion ||= inferLocalizacion(t);
  partial.fechaSiniestro ||= firstMatch(t, [/fecha\s*(?:del)?\s*siniestro\s*:?\s*([\d/\-]{8,10})/i]);
  partial.tipoSiniestro ||= detectOne(t, ['Daños por agua', 'Fenómenos atmosféricos', 'Incendio', 'Robo', 'Responsabilidad civil']);
  partial.causaSiniestro ||= detectSentence(t, ['lluvia', 'viento', 'rotura', 'fuga', 'humedad', 'filtración', 'filtracion']) || partial.causaSiniestro;
  partial.superficieConstruida ||= firstMatch(t, [/superficie\s*(?:construida)?\s*:?\s*(\d{1,4}(?:[,\.]\d{1,2})?)\s*(?:m2|m²|metros)/i, /(\d{1,4}(?:[,\.]\d{1,2})?)\s*(?:m2|m²|metros cuadrados)/i]);
  partial.contenidoSuma ||= firstMatch(t, [/contenido\s*(?:suma|valor(?: real| nuevo)?)?\s*:?\s*(\d{1,3}(?:[. ]\d{3})*(?:,\d{1,2})?)/i, /capital\s+contenido\s*:?\s*(\d{1,3}(?:[. ]\d{3})*(?:,\d{1,2})?)/i]);
  partial.continenteSuma ||= firstMatch(t, [/continente\s*(?:suma|valor(?: real| nuevo)?)?\s*:?\s*(\d{1,3}(?:[. ]\d{3})*(?:,\d{1,2})?)/i, /capital\s+continente\s*:?\s*(\d{1,3}(?:[. ]\d{3})*(?:,\d{1,2})?)/i]);
  partial.codigos ||= detectCodeList(t);
  partial.propuesta ||= detectOne(t, ['Informar', 'Indemnizar', 'Reparar']);
  partial.tipoRol ||= detectOne(t, ['Asegurado', 'Perjudicado', 'Causante']);
  partial.actividad ||= detectOne(t, ACTIVIDADES);
  partial.conceptos ||= detectOne(t, CONCEPTOS);
  if (!partial.otrasCircunstancias) partial.otrasCircunstancias = summarizeTranscript(t);
  if (!partial.observacionesBreves) partial.observacionesBreves = summarizeTranscript(t).slice(0, 280);
  return normalizeCaseBody(partial);
}

function buildReportHtml(item) {
  const continente = computeContinente(item.superficieConstruida, item.continenteSuma);
  const rows = [
    ['Nº expediente', emptyToNoConsta(item.numeroSiniestro)], ['Nº póliza', emptyToNoConsta(item.numeroPoliza)], ['Asegurado', emptyToNoConsta(item.asegurado)],
    ['Situación del riesgo', emptyToNoConsta(item.situacionRiesgo)], ['Tipo de siniestro', emptyToNoConsta(item.tipoSiniestro)], ['Causa del siniestro', emptyToNoConsta(item.causaSiniestro)],
    ['Fecha del siniestro', emptyToNoConsta(item.fechaSiniestro)], ['Localización', emptyToNoConsta(item.localizacion)], ['Año de construcción', emptyToNoConsta(item.anoConstruccion)],
    ['Superficie construida', item.superficieConstruida ? `${item.superficieConstruida} m²` : 'NO CONSTA EN LA NOTA DEL PERITO'], ['Contenido', item.contenidoSuma ? `${item.contenidoSuma} €` : 'NO CONSTA EN LA NOTA DEL PERITO'],
    ['Contenido - causa', item.contenidoSuma ? 'A valor real' : 'NO CONSTA EN LA NOTA DEL PERITO'], ['Continente póliza', item.continenteSuma ? `${item.continenteSuma} €` : 'NO CONSTA EN LA NOTA DEL PERITO'],
    ['Continente calculado', continente.calculado ? `${formatMoneyEs(continente.calculado)} €` : 'NO CONSTA EN LA NOTA DEL PERITO'], ['Continente - causa', continente.causa], ['Propuesta', emptyToNoConsta(item.propuesta)],
    ['Tipo de rol', emptyToNoConsta(item.tipoRol)], ['Actividad', emptyToNoConsta(item.actividad)], ['Conceptos', emptyToNoConsta(item.conceptos)], ['Códigos', emptyToNoConsta(item.codigos)],
  ];
  const rowsHtml = rows.map(([k, v]) => `<tr><th>${k}</th><td>${String(v).replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</td></tr>`).join('');
  const transcript = emptyToNoConsta(item.transcript).replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const otras = emptyToNoConsta(item.otrasCircunstancias).replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const fotos = photosFromArchivos(item.archivos || item.fotos || []);
  const fotosHtml = fotos.length ? `<div class="photos">${fotos.map(f => `<figure><img src="${f.url}" alt="Foto"><figcaption>${(f.name || 'Imagen').replaceAll('<','&lt;').replaceAll('>','&gt;')}</figcaption></figure>`).join('')}</div>` : '<p class="muted">No se han adjuntado fotografías.</p>';
  const filesOnly = normalizeArchivos(item.archivos || []).filter(x => x.kind !== 'image');
  const filesHtml = filesOnly.length ? `<ul class="file-list">${filesOnly.map(f => `<li>${(f.name || 'Archivo').replaceAll('<','&lt;').replaceAll('>','&gt;')}</li>`).join('')}</ul>` : '<p class="muted">No se han adjuntado otros archivos.</p>';
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Informe ${item.numeroSiniestro || 'siniestro'}</title><style>
  body{font-family:Inter,Arial,sans-serif;margin:0;background:#eef5fb;color:#10233d}.page{max-width:980px;margin:28px auto;background:#fff;border-radius:24px;overflow:hidden;box-shadow:0 20px 60px rgba(16,35,61,.14)}.hero{padding:30px;background:linear-gradient(135deg,#0d3566,#5fc4ff);color:#fff}.hero h1{margin:0 0 6px;font-size:34px}.hero p{margin:0;opacity:.92}.block{padding:24px 30px;border-top:1px solid #d9e5f3}.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}.card{background:#f5f9fd;border:1px solid #d9e5f3;border-radius:18px;padding:18px}h2{margin:0 0 14px;font-size:22px;color:#0d3566}table{width:100%;border-collapse:collapse;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #d9e5f3}th,td{padding:12px 14px;border-bottom:1px solid #e6eef7;text-align:left;vertical-align:top}th{width:34%;background:#f4f8fc;color:#28507f}pre{white-space:pre-wrap;font-family:inherit;line-height:1.6;margin:0;background:#f7fbff;border:1px solid #d9e5f3;padding:18px;border-radius:16px}.photos{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.photos figure{margin:0;background:#fff;border:1px solid #d9e5f3;padding:10px;border-radius:18px}.photos img{width:100%;height:230px;object-fit:cover;border-radius:12px}.photos figcaption,.file-list li{font-size:12px;margin-top:8px;color:#46617f}.muted{color:#5b7492}.file-list{margin:0;padding-left:20px}.footer{padding:18px 30px;background:#0d3566;color:#d8ecff;font-size:13px}@media print{body{background:#fff}.page{margin:0;box-shadow:none;border-radius:0}}@media (max-width:720px){.grid,.photos{grid-template-columns:1fr}.hero h1{font-size:28px}th{width:42%}}
  </style></head><body><div class="page"><div class="hero"><h1>Gómez Prieto SL</h1><p>Informe pericial del siniestro ${item.numeroSiniestro || 'SIN NÚMERO'}</p></div><div class="block"><h2>Resumen del expediente</h2><table>${rowsHtml}</table></div><div class="block grid"><div class="card"><h2>Otras circunstancias / informe pericial</h2><pre>${otras}</pre></div><div class="card"><h2>Transcripción fiel del perito</h2><pre>${transcript}</pre></div></div><div class="block"><h2>Fotografías adjuntas</h2>${fotosHtml}</div><div class="block"><h2>Archivos adjuntos</h2>${filesHtml}</div><div class="footer">Documento generado desde el portal interno de Gómez Prieto SL. Solo contiene información disponible en la nota de voz, las fotos, los archivos y la transcripción del perito.</div></div></body></html>`;
}

app.get('/api/options', (_req, res) => res.json({ actividades: ACTIVIDADES, conceptos: CONCEPTOS }));
app.get('/api/siniestros', (req, res) => {
  const q = cleanText(req.query.q || '').toLowerCase(); const estado = cleanText(req.query.estado || '').toLowerCase();
  let data = sortNewest(readDb()); if (estado === 'pendiente') data = data.filter(x => x.estado !== 'Hecho'); if (estado === 'hecho') data = data.filter(x => x.estado === 'Hecho');
  if (q) data = data.filter(item => [item.numeroSiniestro, item.numeroPoliza, item.asegurado, item.situacionRiesgo, item.transcript, item.otrasCircunstancias].some(v => cleanText(v).toLowerCase().includes(q)));
  res.json(data);
});
app.get('/api/siniestros/:id', (req, res) => {
  const item = readDb().find(x => x.id === req.params.id); if (!item) return res.status(404).json({ error: 'Siniestro no encontrado' }); res.json(item);
});
app.post('/api/siniestros', upload.fields([{ name: 'audio', maxCount: 1 }, { name: 'archivos', maxCount: 30 }, { name: 'fotos', maxCount: 30 }]), (req, res) => {
  if (!cleanText(req.body.numeroSiniestro)) return res.status(400).json({ error: 'El número de expediente es obligatorio' });
  const db = readDb(); if (db.some(x => x.numeroSiniestro === cleanText(req.body.numeroSiniestro))) return res.status(409).json({ error: 'Ya existe un siniestro con ese número de expediente' });
  const audioFile = req.files?.audio?.[0];
  const incoming = [...(req.files?.archivos || []), ...(req.files?.fotos || [])].map(fileRecord);
  const item = normalizeCaseBody({ ...req.body, estado: req.body.estado || 'Pendiente', audioUrl: audioFile ? `/uploads/${audioFile.filename}` : '', archivos: incoming });
  db.push(item); writeDb(db); res.status(201).json(item);
});
app.put('/api/siniestros/:id', (req, res) => {
  const db = readDb(); const idx = db.findIndex(x => x.id === req.params.id); if (idx === -1) return res.status(404).json({ error: 'Siniestro no encontrado' });
  db[idx] = normalizeCaseBody({ ...db[idx], ...req.body }, db[idx]); writeDb(db); res.json(db[idx]);
});
app.post('/api/siniestros/:id/files', upload.array('archivos', 30), (req, res) => {
  const db = readDb(); const idx = db.findIndex(x => x.id === req.params.id); if (idx === -1) return res.status(404).json({ error: 'Siniestro no encontrado' });
  const current = normalizeArchivos(db[idx].archivos || db[idx].fotos || []); const incoming = (req.files || []).map(fileRecord);
  db[idx].archivos = mergeArchivos(current, incoming); db[idx].fotos = photosFromArchivos(db[idx].archivos); db[idx].updatedAt = new Date().toISOString(); writeDb(db); res.json(db[idx]);
});
app.delete('/api/siniestros/:id/files/:index', (req, res) => {
  const db = readDb(); const idx = db.findIndex(x => x.id === req.params.id); if (idx === -1) return res.status(404).json({ error: 'Siniestro no encontrado' });
  const findex = Number(req.params.index); const file = (db[idx].archivos || [])[findex]; if (!file) return res.status(404).json({ error: 'Archivo no encontrado' });
  const fp = path.join(ROOT, file.url.replace(/^\//, '')); if (fs.existsSync(fp)) fs.unlinkSync(fp);
  db[idx].archivos.splice(findex, 1); db[idx].fotos = photosFromArchivos(db[idx].archivos); db[idx].updatedAt = new Date().toISOString(); writeDb(db); res.json(db[idx]);
});
app.post('/api/siniestros/:id/autofill', (req, res) => {
  const db = readDb(); const idx = db.findIndex(x => x.id === req.params.id); if (idx === -1) return res.status(404).json({ error: 'Siniestro no encontrado' });
  db[idx] = autofillFromTranscript(db[idx]); writeDb(db); res.json(db[idx]);
});
app.patch('/api/siniestros/:id/state', (req, res) => {
  const db = readDb(); const idx = db.findIndex(x => x.id === req.params.id); if (idx === -1) return res.status(404).json({ error: 'Siniestro no encontrado' });
  db[idx].estado = cleanText(req.body.estado) || db[idx].estado; db[idx].updatedAt = new Date().toISOString(); writeDb(db); res.json(db[idx]);
});
app.get('/api/siniestros/:id/report', (req, res) => {
  const item = readDb().find(x => x.id === req.params.id); if (!item) return res.status(404).send('No encontrado');
  const html = buildReportHtml(item); res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename="informe-${(item.numeroSiniestro || 'siniestro').replace(/[^\w.-]+/g, '-')}.html"`); res.send(html);
});
app.get('/api/siniestros/:id/files-zip', (req, res) => {
  const item = readDb().find(x => x.id === req.params.id); if (!item) return res.status(404).json({ error: 'Siniestro no encontrado' });
  const archivos = normalizeArchivos(item.archivos || item.fotos || []); if (!archivos.length) return res.status(404).json({ error: 'Este siniestro no tiene archivos' });
  res.setHeader('Content-Type', 'application/zip'); res.setHeader('Content-Disposition', `attachment; filename="${downloadNameForCase(item, 'archivos', 'zip')}"`);
  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', () => { if (!res.headersSent) res.status(500).json({ error: 'No se pudo generar el ZIP de archivos' }); else res.end(); });
  archive.pipe(res);
  const manifest = ['Gómez Prieto SL', `Siniestro: ${item.numeroSiniestro || 'SIN NÚMERO'}`, `Archivos incluidos: ${archivos.length}`, `Generado: ${new Date().toLocaleString('es-ES')}`, '', ...archivos.map((f, i) => `${i + 1}. ${f.name || 'Archivo'} (${f.kind})`)].join('\n');
  archive.append(manifest, { name: '00-listado-archivos.txt' });
  archivos.forEach((file, index) => {
    const fp = path.join(ROOT, file.url.replace(/^\//, ''));
    if (fs.existsSync(fp)) {
      const ext = path.extname(fp) || path.extname(file.name || '') || '.bin';
      const folder = file.kind === 'image' ? 'fotos' : 'archivos';
      archive.file(fp, { name: `${folder}/${String(index + 1).padStart(2, '0')}-${safeFileName(path.basename(file.name || `archivo-${index + 1}${ext}`))}` });
    }
  });
  archive.finalize();
});
app.delete('/api/siniestros/:id', (req, res) => {
  const db = readDb(); const idx = db.findIndex(x => x.id === req.params.id); if (idx === -1) return res.status(404).json({ error: 'Siniestro no encontrado' });
  const [removed] = db.splice(idx, 1); const files = [removed.audioUrl, ...((removed.archivos || removed.fotos || []).map(f => f.url))].filter(Boolean);
  for (const f of files) { const fp = path.join(ROOT, f.replace(/^\//, '')); if (fs.existsSync(fp)) fs.unlinkSync(fp); }
  writeDb(db); res.json({ ok: true });
});
app.delete('/api/siniestros-hechos', (_req, res) => {
  const db = readDb(); const keep = db.filter(x => x.estado !== 'Hecho'); const removed = db.filter(x => x.estado === 'Hecho');
  for (const item of removed) {
    const files = [item.audioUrl, ...((item.archivos || item.fotos || []).map(f => f.url))].filter(Boolean);
    for (const f of files) { const fp = path.join(ROOT, f.replace(/^\//, '')); if (fs.existsSync(fp)) fs.unlinkSync(fp); }
  }
  writeDb(keep); res.json({ ok: true, removed: removed.length });
});
app.get('*', (_req, res) => res.sendFile(path.join(ROOT, 'public', 'index.html')));
app.listen(PORT, () => console.log(`Portal listo en http://localhost:${PORT}`));
