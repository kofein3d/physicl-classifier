// Уведомление о результате ночного прогона на почту (переиспользует send_email.mjs).
// Вызов: node scripts/notify.mjs <status>   (status = success | failure | cancelled)
import { sendEmail } from './send_email.mjs'

const status = (process.argv[2] || 'unknown').toLowerCase()
const ok = status === 'success'
const mark = ok ? '✅' : '❌'
const subject = `${mark} Pivot update — ${status}`
const body =
  `Workflow: Update pivot data (kofein3d/physicl-classifier)\n` +
  `Status: ${status}\n` +
  `Time (UTC): ${new Date().toISOString()}\n` +
  (process.env.RUN_URL ? `Run: ${process.env.RUN_URL}\n` : '')

await sendEmail(subject, body)
