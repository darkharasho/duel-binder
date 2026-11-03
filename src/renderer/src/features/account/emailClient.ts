import type { EmailAuthView, EmailStep } from '@shared/emailAuth'

/**
 * How an app talks to the portal's email sign-in. `step` posts one step and resolves the portal's
 * reply without any session token (the client keeps that). Everything rejects with an Error whose
 * message is the portal's copy; an empty message means nothing to show (the person closed a sheet).
 * `linkDiscord` / `linkApple` exist only where the app can prove that provider.
 */
export interface EmailAuthClient {
  step(step: EmailStep, body: Record<string, unknown>): Promise<EmailAuthView>
  linkDiscord?(ticket: string): Promise<EmailAuthView>
  linkApple?(ticket: string): Promise<EmailAuthView>
}
