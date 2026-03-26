declare module "nodemailer" {
  interface Transport {
    sendMail(options: { from?: string; to: string; subject: string; text?: string }): Promise<unknown>;
  }
  const nodemailer: {
    createTransport: (options: unknown) => Transport;
  };
  export default nodemailer;
}
