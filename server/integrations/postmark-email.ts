export type ReportEmail = { to: string; subject: string; textBody: string }
export type ReportEmailResult = { id: string }
export interface ReportEmailProvider { send(input: ReportEmail): Promise<ReportEmailResult> }

export class PostmarkEmailProvider implements ReportEmailProvider {
  constructor(private readonly token: string, private readonly from: string) {}

  async send(input: ReportEmail) {
    const response = await fetch('https://api.postmarkapp.com/email', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Postmark-Server-Token': this.token,
      },
      body: JSON.stringify({ From: this.from, To: input.to, Subject: input.subject, TextBody: input.textBody, MessageStream: 'outbound', Tag: 'weekly-revenue-report' }),
      signal: AbortSignal.timeout(8_000),
    })
    const payload = await response.json() as { MessageID?: string; Message?: string; ErrorCode?: number }
    if (!response.ok || !payload.MessageID || payload.ErrorCode) throw new Error(`Postmark report delivery failed: ${payload.Message ?? response.status}`)
    return { id: payload.MessageID }
  }
}
