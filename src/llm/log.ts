export function logExchange(service: 'LLM' | 'Parallel', direction: 'sent' | 'received', detail: unknown): void {
  console.log(`[iEdit ${service}] ${direction}`, detail)
}
