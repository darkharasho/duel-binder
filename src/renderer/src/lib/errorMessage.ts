/** An error's message without Electron's "Error invoking remote method '…': Error: " IPC prefix. */
export function errorMessage(error: unknown, fallback = 'Something went wrong'): string {
  if (!(error instanceof Error)) return fallback
  return error.message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '')
}
