const nodemailer = require("nodemailer");
require("dotenv").config();

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS, // Use App Password if 2FA is enabled
  },
});

const sendSignupEmail = async (to, name = "there", retries = 3) => {
  const mailOptions = {
    from: '"DROP" <no-reply@drop.ng>',
    to,
    subject: "Welcome to DROP — Your Rides & Deliveries Made Easy 🚗📦",
    text: "Welcome to DROP! Book rides and send packages anytime, fast and safe.",
    html: `
    <div style="font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f4f6f8; padding: 40px 16px;">
      <div style="max-width: 600px; margin: auto; background: #ffffff; border-radius: 16px; box-shadow: 0 12px 40px rgba(0,0,0,0.08); overflow: hidden;">

        <!-- Logo -->
        <div style="text-align: center; padding: 30px 0 10px;">
          <img src="https://drop.ng/logo.png" alt="DROP" width="140" style="display: block; margin: 0 auto;" />
        </div>

        <!-- Header -->
        <div style="background: linear-gradient(135deg, #32D74B, #1DB954); padding: 28px; text-align: center;">
          <h1 style="margin: 0; color: #0b0b0b; font-size: 28px; font-weight: 700;">Welcome to DROP</h1>
          <p style="margin: 6px 0 0; color: #0b0b0b; font-size: 14px; font-weight: 500;">Ride fast. Deliver smarter.</p>
        </div>

        <!-- Body -->
        <div style="padding: 36px; color: #111827;">
          <p style="font-size: 16px;">Hi <strong>${name}</strong>,</p>
          <p style="font-size: 16px; color: #374151; margin-top: 12px;">
            Welcome to <strong>DROP</strong> — your go-to platform for:
          </p>

          <ul style="padding-left: 20px; color: #374151; font-size: 15px; margin-top: 12px;">
            <li>Fast & reliable rides</li>
            <li>Secure package deliveries</li>
            <li>Real-time tracking</li>
          </ul>

          <p style="font-size: 15px; color: #374151; margin-top: 20px;">
            You don’t need to do anything now — you can book a ride or send a package whenever you’re ready.
          </p>

          <!-- CTA Buttons side by side -->
          <div style="text-align: center; margin: 30px 0;">
           <table align="center" cellpadding="0" cellspacing="0" border="0">
  <tr>
    <td align="center" style="padding: 0 6px;">
      <a href="https://drop.ng/ride" style="...">Book a Ride</a>
    </td>
    <td align="center" style="padding: 0 6px;">
      <a href="https://drop.ng/delivery" style="...">Send a Package</a>
    </td>
  </tr>
</table>

          </div>

          <p style="font-size: 14px; color: #6b7280;">Need help or have questions? Just reply to this email — we’ve got you.</p>
          <p style="font-size: 14px; color: #6b7280; margin-top: 12px;">
            Safe trips and smooth deliveries,<br/>
            <strong>The DROP Team</strong>
          </p>
        </div>

        <!-- Footer -->
        <div style="background-color: #f9fafb; padding: 20px; text-align: center; font-size: 12px; color: #9ca3af;">
          &copy; ${new Date().getFullYear()} DROP. All rights reserved.
        </div>

      </div>
    </div>
    `,
  };

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await transporter.sendMail(mailOptions);
      console.log(`Signup email sent successfully to ${to}`);
      return { success: true };
    } catch (error) {
      console.error(`Attempt ${attempt} - Error sending signup email:`, error);
      if (attempt === retries) {
        return { success: false, error };
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
};

module.exports = sendSignupEmail;
