export function greet(name) {
  const who = String(name ?? 'world').trim()
  return `hello ${who}`
}

export function sum(values) {
  let total = 0
  for (const value of values) total += value
  return total
}
