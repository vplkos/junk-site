// 垃圾站后端（Node.js，零依赖）
const http = require('http');
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

const server = http.createServer((req, res) => {
  computePi();
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
});

const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log('垃圾站已启动，端口 ' + port);
});
