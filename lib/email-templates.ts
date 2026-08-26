const BRAND_BLUE = "#1e5a9e";
const TEXT_COLOR = "#1f2937";
const MUTED_COLOR = "#6b7280";
const BORDER_COLOR = "#e5e7eb";

/**
 * HTML for the password-reset email. Table-based layout + inline styles for
 * compatibility with Outlook/Gmail rendering engines.
 */
export function passwordResetEmailHtml({
  resetUrl,
  appUrl,
}: {
  resetUrl: string;
  appUrl: string;
}): string {
  return `<!DOCTYPE html>
<html lang="en">
  <body style="margin:0; padding:0; background-color:#f4f5f7; font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f5f7; padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px; width:100%; background-color:#ffffff; border-radius:8px; border:1px solid ${BORDER_COLOR}; overflow:hidden;">
            <tr>
              <td style="padding:32px 32px 0 32px;">
                <img src="${appUrl}/assets/trak_logo_color.png" alt="Trak by WasteZero" width="140" style="display:block; height:auto;" />
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 8px 32px;">
                <h1 style="margin:0; font-size:20px; line-height:28px; color:${TEXT_COLOR};">Reset your password</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 24px 32px;">
                <p style="margin:0 0 16px 0; font-size:14px; line-height:22px; color:${TEXT_COLOR};">
                  We received a request to reset the password for your Trak account. Click the button below to choose a new one.
                </p>
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="border-radius:6px; background-color:${BRAND_BLUE};">
                      <a href="${resetUrl}" style="display:inline-block; padding:12px 24px; font-size:14px; font-weight:600; color:#ffffff; text-decoration:none;">
                        Reset password
                      </a>
                    </td>
                  </tr>
                </table>
                <p style="margin:24px 0 0 0; font-size:13px; line-height:20px; color:${MUTED_COLOR};">
                  If the button doesn't work, copy and paste this link into your browser:
                </p>
                <p style="margin:4px 0 0 0; font-size:13px; line-height:20px; word-break:break-all;">
                  <a href="${resetUrl}" style="color:${BRAND_BLUE};">${resetUrl}</a>
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px 32px 32px; border-top:1px solid ${BORDER_COLOR};">
                <p style="margin:16px 0 0 0; font-size:12px; line-height:18px; color:${MUTED_COLOR};">
                  If you didn't request a password reset, you can safely ignore this email — your password won't change.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
