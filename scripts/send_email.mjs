// ─────────────────────────────────────────────────────────────────────────────
// send_email.mjs — отправка письма-уведомления через Gmail SMTP (smtp.gmail.com:465).
// Сырой SMTP-разговор на встроенном модуле tls — без npm-зависимостей.
// Креды — в email.config.json рядом (from, to, appPassword). В CI файл собирается из секрета.
// (Копия проверенного модуля из пайплайна D1/SKU — тот же стиль, тот же механизм.)
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'
import tls from 'tls'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CONFIG_PATH = path.join(__dirname, 'email.config.json')

function b64(s) { return Buffer.from(s, 'utf-8').toString('base64') }

function encodeSubject(subject) {
  if (/^[\x00-\x7F]*$/.test(subject)) return subject
  return `=?UTF-8?B?${b64(subject)}?=`
}

function readResponse(socket, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let buf = ''
    const timer = setTimeout(() => { cleanup(); reject(new Error('SMTP: timeout waiting for response')) }, timeoutMs)
    function onData(chunk) {
      buf += chunk.toString('utf-8')
      const lines = buf.split('\r\n').filter(Boolean)
      const last = lines[lines.length - 1]
      if (last && /^\d{3} /.test(last)) { cleanup(); resolve(buf) }
    }
    function onErr(e) { cleanup(); reject(e) }
    function onEnd() { cleanup(); reject(new Error('SMTP: connection closed unexpectedly')) }
    function cleanup() { clearTimeout(timer); socket.off('data', onData); socket.off('error', onErr); socket.off('end', onEnd) }
    socket.on('data', onData)
    socket.on('error', onErr)
    socket.on('end', onEnd)
  })
}
function sendLine(socket, line) { socket.write(line + '\r\n') }

export async function sendEmail(subject, bodyText) {
  if (!existsSync(CONFIG_PATH)) { console.log('[email] email.config.json не найден — письмо не отправлено.'); return }
  let cfg
  try { cfg = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) } catch { console.log('[email] email.config.json повреждён — письмо не отправлено.'); return }
  if (!cfg.from || !cfg.to || !cfg.appPassword || /ВСТАВЬ/.test(cfg.appPassword)) {
    console.log('[email] в email.config.json не заполнены from/to/appPassword — письмо не отправлено.'); return
  }

  let socket
  try {
    socket = tls.connect({ host: 'smtp.gmail.com', port: 465 })
    await new Promise((resolve, reject) => { socket.once('secureConnect', resolve); socket.once('error', reject) })

    await readResponse(socket)
    sendLine(socket, 'EHLO localhost'); await readResponse(socket)
    sendLine(socket, 'AUTH LOGIN'); await readResponse(socket)
    sendLine(socket, b64(cfg.from)); await readResponse(socket)
    sendLine(socket, b64(cfg.appPassword)); await readResponse(socket)
    sendLine(socket, `MAIL FROM:<${cfg.from}>`); await readResponse(socket)
    sendLine(socket, `RCPT TO:<${cfg.to}>`); await readResponse(socket)
    sendLine(socket, 'DATA'); await readResponse(socket)

    const normalized = String(bodyText).replace(/\r\n/g, '\n').replace(/\n/g, '\r\n')
    const dotStuffed = normalized.split('\r\n').map(l => l.startsWith('.') ? '.' + l : l).join('\r\n')

    const message =
      `From: ${cfg.from}\r\n` +
      `To: ${cfg.to}\r\n` +
      `Subject: ${encodeSubject(subject)}\r\n` +
      `Content-Type: text/plain; charset=UTF-8\r\n` +
      `\r\n${dotStuffed}\r\n.\r\n`
    socket.write(message)
    await readResponse(socket)

    sendLine(socket, 'QUIT')
    try { await readResponse(socket) } catch {}
    console.log(`[email] письмо отправлено: "${subject}"`)
  } catch (e) {
    console.log('[email] отправка не удалась: ' + e.message)
  } finally {
    try { socket && socket.end() } catch {}
  }
}
