// 垃圾站后端（Node.js，零依赖）
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

// 后台定时任务
function computePi() {
  let pi = 0;
  const terms = 20000;
  for (let k = 0; k < terms; k++) {
    pi += (k % 2 === 0 ? 1 : -1) / (2 * k + 1);
  }
  pi = pi * 4;
  let h = 0;
  for (let i = 0; i < 200000; i++) {
    h = (h * 31 + Math.floor(Math.random() * 1e9)) % 1000000007;
  }
  return { pi, h };
}

// 每秒跑一次后台任务
setInterval(() => {
  computePi();
}, 1000);

// 访客计数：启动时读文件，之后每次访问 +1 并写回文件
const countFile = path.join(__dirname, 'visits.txt');
let visitors = 0;
try {
  visitors = parseInt(fs.readFileSync(countFile, 'utf8'), 10) || 0;
} catch (e) {
  visitors = 0;
}

// 访客记录只存服务端（不展示给所有人看），最近 20 条，启动时读文件
const logFile = path.join(__dirname, 'visits.json');
let recent = [];
try {
  recent = JSON.parse(fs.readFileSync(logFile, 'utf8'));
  if (!Array.isArray(recent)) recent = [];
} catch (e) {
  recent = [];
}
const ipCounts = new Map();
for (const v of recent) {
  if (v.ip) ipCounts.set(v.ip, (ipCounts.get(v.ip) || 0) + 1);
}

function saveRecent() {
  try { fs.writeFileSync(logFile, JSON.stringify(recent)); } catch (e) {}
}

function clientIp(req) {
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';
  return ip.replace(/^::ffff:/, '');
}

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// 从 User-Agent 里认浏览器、系统、设备
function parseUA(ua) {
  let browser = '未知';
  let m;
  if ((m = ua.match(/Edg\/([\d.]+)/))) browser = 'Edge ' + m[1].split('.')[0];
  else if ((m = ua.match(/OPR\/([\d.]+)/))) browser = 'Opera ' + m[1].split('.')[0];
  else if ((m = ua.match(/Chrome\/([\d.]+)/))) browser = 'Chrome ' + m[1].split('.')[0];
  else if ((m = ua.match(/Firefox\/([\d.]+)/))) browser = 'Firefox ' + m[1].split('.')[0];
  else if ((m = ua.match(/Version\/([\d.]+).*Safari/))) browser = 'Safari ' + m[1].split('.')[0];
  else if (ua.indexOf('curl/') === 0) browser = 'curl ' + ua.slice(5).split(' ')[0];
  else if ((m = ua.match(/^([A-Za-z]+)\/([\d.]+)/))) browser = m[1] + ' ' + m[2].split('.')[0];

  let os = '未知';
  if (/Windows NT 10\.0/.test(ua)) os = 'Windows 10/11';
  else if ((m = ua.match(/Windows NT ([\d.]+)/))) os = 'Windows ' + m[1];
  else if ((m = ua.match(/Mac OS X ([\d_]+)/))) os = 'macOS ' + m[1].replace(/_/g, '.');
  else if ((m = ua.match(/Android ([\d.]+)/))) os = 'Android ' + m[1];
  else if ((m = ua.match(/iPhone OS ([\d_]+)/))) os = 'iOS ' + m[1].replace(/_/g, '.');
  else if (/Linux/.test(ua)) os = 'Linux';

  let device = '电脑';
  if (/iPhone|Android/.test(ua) && /Mobile/.test(ua)) device = '手机';
  else if (/iPad/.test(ua)) device = '平板';
  return { browser, os, device };
}

// 天气代码转中文（Open-Meteo WMO 代码）
const WEATHER = { 0: '晴', 1: '大致晴', 2: '多云', 3: '阴', 45: '雾', 48: '雾凇', 51: '毛毛雨', 53: '毛毛雨', 55: '毛毛雨', 56: '冻毛毛雨', 57: '冻毛毛雨', 61: '小雨', 63: '中雨', 65: '大雨', 66: '冻雨', 67: '冻雨', 71: '小雪', 73: '中雪', 75: '大雪', 77: '雪粒', 80: '阵雨', 81: '阵雨', 82: '暴雨', 85: '阵雪', 86: '阵雪', 95: '雷雨', 96: '雷雨冰雹', 99: '雷雨冰雹' };

function getJSON(url, timeoutMs) {
  return new Promise((resolve) => {
    const lib = url.indexOf('https') === 0 ? https : http;
    const req = lib.get(url, { timeout: timeoutMs }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { resolve(null); }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

// 按 IP 查归属地 + 当地天气（免费接口，无需 key），查不到就留空
const geoCache = new Map();
async function enrich(visit) {
  const ip = visit.ip;
  if (!ip || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1|100\.)/.test(ip)) {
    visit.loc = '本地/内网';
    visit.weather = '-';
    saveRecent();
    return;
  }
  const cached = geoCache.get(ip);
  if (cached && Date.now() - cached.at < 30 * 60 * 1000) {
    Object.assign(visit, cached.data);
    saveRecent();
    return;
  }
  const geo = await getJSON('http://ip-api.com/json/' + encodeURIComponent(ip) + '?fields=status,country,city,isp,lat,lon', 5000);
  if (!geo || geo.status !== 'success') {
    visit.loc = '查不到';
    visit.weather = '-';
    saveRecent();
    return;
  }
  let weather = '-';
  const w = await getJSON('https://api.open-meteo.com/v1/forecast?latitude=' + geo.lat + '&longitude=' + geo.lon + '&current=temperature_2m,weather_code,wind_speed_10m', 5000);
  if (w && w.current) {
    weather = (WEATHER[w.current.weather_code] || '未知') + ' ' + w.current.temperature_2m + '°C 风速' + w.current.wind_speed_10m + 'km/h';
  }
  const data = { loc: ((geo.country || '') + ' ' + (geo.city || '')).trim() || '未知', isp: geo.isp || '', weather: weather };
  geoCache.set(ip, { at: Date.now(), data: data });
  Object.assign(visit, data);
  saveRecent();
}

// （访客自己的信息直接注入原表格各行，不另设标题栏）

const server = http.createServer(async (req, res) => {
  // 浏览器上报屏幕/语言/时区：不计数，只补到最近一次同 IP 访问上
  if (req.url === '/ping' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 2048) req.destroy(); });
    req.on('end', () => {
      try {
        const extra = JSON.parse(body);
        const ip = clientIp(req);
        for (let i = recent.length - 1; i >= 0; i--) {
          if (recent[i].ip === ip && Date.now() - (recent[i].ts || 0) < 120000) {
            if (extra.w && extra.h) recent[i].screen = extra.w + 'x' + extra.h;
            if (extra.lang) recent[i].lang = extra.lang;
            if (extra.tz) recent[i].tz = extra.tz;
            saveRecent();
            break;
          }
        }
      } catch (e) {}
      res.writeHead(204);
      res.end();
    });
    return;
  }

  // 健康检查：保活用，不计数、不记日志
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('ok');
    return;
  }

  // favicon 不计数
  if (req.url === '/favicon.ico') {
    res.writeHead(204);
    res.end();
    return;
  }

  computePi();
  visitors++;
  try { fs.writeFileSync(countFile, String(visitors)); } catch (e) {}

  const ip = clientIp(req);
  const ua = req.headers['user-agent'] || '';
  const parsed = parseUA(ua);
  const n = (ipCounts.get(ip) || 0) + 1;
  ipCounts.set(ip, n);
  const visit = {
    ts: Date.now(),
    time: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
    ip: ip,
    n: n,
    ua: ua,
    browser: parsed.browser,
    os: parsed.os,
    device: parsed.device,
    loc: '查询中…',
    weather: '查询中…',
    path: req.url || '/',
    ref: req.headers['referer'] || req.headers['referrer'] || ''
  };
  recent.push(visit);
  if (recent.length > 20) recent = recent.slice(-20);
  saveRecent();
  console.log('访客 #' + visitors, visit.time, visit.ip, visit.browser, visit.os);

  // 等归属地/天气查完再返回（最多等 3.5 秒，超时就先返回，查到后只记服务端）
  await Promise.race([enrich(visit), new Promise((r) => setTimeout(r, 3500))]);

  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const numbered = html
    .replace('<span class="counter">000001</span>', '<span class="counter">' + String(visitors).padStart(6, '0') + '</span>')
    .replace('<!--WEATHER-->', esc(visit.weather || '查询中…'))
    .replace('<!--MYIP-->', esc(visit.ip) + '（第' + (visit.n || 1) + '次来）')
    .replace('<!--MYLOC-->', esc(visit.loc || '查询中…') + (visit.isp ? ' / ' + esc(visit.isp) : ''))
    .replace('<!--MYBROWSER-->', esc(visit.browser) + ' / ' + esc(visit.os) + ' / ' + esc(visit.device));
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(numbered);
});

const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log('垃圾站已启动，端口 ' + port);
});
