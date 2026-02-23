import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { Order } from '../../database/entities/order.entity';
import { LogsService } from '../logs/logs.service';
import { LogModule } from '../../database/entities/log.entity';
import { MerchantsService } from '../merchants/merchants.service';

@Injectable()
export class EmailService {
  private resend: Resend;

  constructor(
    @InjectRepository(Order)
    private orderRepository: Repository<Order>,
    private configService: ConfigService,
    private logsService: LogsService,
    private merchantsService: MerchantsService,
  ) {
    const resendKey = this.configService.get('RESEND_KEY') || this.configService.get('resend_key');
    this.resend = new Resend(resendKey);
  }

  async sendOrderStatusEmails(
    order: Order,
    previousStatus: string | null = null,
    providedMerchantEmail: string | null = null,
  ): Promise<void> {
    try {
      // Use provided merchant email if available, otherwise look it up
      let merchantEmail = providedMerchantEmail;


      if (!merchantEmail) {
        console.error('Merchant email not found');
        return;
      }

      // Ensure merchant email is not the same as customer email
      if (merchantEmail === order.customer_email) {
        console.error('CRITICAL: Merchant email matches customer email!');
        return;
      }

      const normalizedStatus = order.status ? String(order.status).toLowerCase().trim() : null;

      switch (normalizedStatus) {
        case 'pending':
        case 'on-hold':
        case 'onhold':
          await Promise.allSettled([
            this.sendOnHoldEmail(order, merchantEmail),
            this.sendNewOrderEmail(order, merchantEmail),
          ]);
          break;

        case 'processing':
          await Promise.allSettled([
            this.sendProcessingEmail(order, merchantEmail),
            this.sendProcessingNotificationToMerchant(order, merchantEmail),
          ]);
          break;

        case 'completed':
          await Promise.allSettled([
            this.sendCompletedEmail(order, merchantEmail),
            this.sendCompletedNotificationToMerchant(order, merchantEmail),
          ]);
          break;

        default:
          console.warn(`No email template for status: ${order.status}`);
      }
    } catch (error) {
      console.error('Error in sendOrderStatusEmails:', error);
    }
  }

  private async sendOnHoldEmail(order: Order, merchantEmail: string) {
    const fromEmail = this.configService.get('EMAIL_FROM') || 'noreply@dexxpay.com';
    const subject = `Complete Your Order — e-Transfer Details`;
    const html = await this.getOnHoldEmailTemplate(order, merchantEmail);

    try {
      await this.resend.emails.send({
        from: fromEmail,
        to: order.customer_email,
        subject,
        html,
      });

      // Log successful email send
      this.logsService
        .createLog({
          module: LogModule.EMAIL,
          action: 'send',
          entity_id: order.id,
          details: {
            order_id: order.id,
            to: order.customer_email,
            subject,
            type: 'on_hold',
          },
        })
        .catch((err) => console.error('Error logging email send:', err));
    } catch (error) {
      // Log email send failure
      this.logsService
        .createLog({
          module: LogModule.EMAIL,
          action: 'send_failed',
          entity_id: order.id,
          details: {
            order_id: order.id,
            to: order.customer_email,
            subject,
            type: 'on_hold',
            error: error instanceof Error ? error.message : String(error),
          },
        })
        .catch((err) => console.error('Error logging email failure:', err));
      throw error;
    }
  }

  private async sendNewOrderEmail(order: Order, merchantEmail: string) {
    const fromEmail = this.configService.get('EMAIL_FROM') || 'noreply@dexxpay.com';
    const subject = `New e-Transfer Order Received`;
    const html = await this.getNewOrderEmailTemplate(order);

    if (merchantEmail === order.customer_email) {
      throw new Error(`Cannot send merchant email to customer email: ${merchantEmail}`);
    }

    try {
      await this.resend.emails.send({
        from: fromEmail,
        to: merchantEmail,
        subject,
        html,
      });

      // Log successful email send
      this.logsService
        .createLog({
          module: LogModule.EMAIL,
          action: 'send',
          entity_id: order.id,
          details: {
            order_id: order.id,
            to: merchantEmail,
            subject,
            type: 'new_order',
          },
        })
        .catch((err) => console.error('Error logging email send:', err));
    } catch (error) {
      // Log email send failure
      this.logsService
        .createLog({
          module: LogModule.EMAIL,
          action: 'send_failed',
          entity_id: order.id,
          details: {
            order_id: order.id,
            to: merchantEmail,
            subject,
            type: 'new_order',
            error: error instanceof Error ? error.message : String(error),
          },
        })
        .catch((err) => console.error('Error logging email failure:', err));
      throw error;
    }
  }

  private async sendProcessingEmail(order: Order, merchantEmail: string) {
    // Reload order from database to get latest email sent status
    const latestOrder = await this.orderRepository.findOne({ where: { id: order.id } });
    if (!latestOrder) {
      console.error(`Order ${order.id} not found in database`);
      return;
    }

    // Check if this email has already been sent for this order using database field
    if (latestOrder.payment_received_customer_email_sent) {
      console.log(`Payment received customer email already sent for order ${order.id}. Skipping.`);
      return;
    }

    const fromEmail = this.configService.get('EMAIL_FROM') || 'noreply@dexxpay.com';
    const subject = `Payment Received — Order Now Processing`;
    const html = await this.getProcessingEmailTemplate(order);

    try {
      await this.resend.emails.send({
        from: fromEmail,
        to: latestOrder.customer_email,
        subject,
        html,
      });

      // Update order to mark email as sent
      latestOrder.payment_received_customer_email_sent = true;
      await this.orderRepository.save(latestOrder);

      // Log successful email send
      this.logsService
        .createLog({
          module: LogModule.EMAIL,
          action: 'send',
          entity_id: order.id,
          details: {
            order_id: order.id,
            to: order.customer_email,
            subject,
            type: 'processing_customer_email',
          },
        })
        .catch((err) => console.error('Error logging email send:', err));
    } catch (error) {
      // Log email send failure
      this.logsService
        .createLog({
          module: LogModule.EMAIL,
          action: 'send_failed',
          entity_id: order.id,
          details: {
            order_id: order.id,
            to: order.customer_email,
            subject,
            type: 'processing_customer_email',
            error: error instanceof Error ? error.message : String(error),
          },
        })
        .catch((err) => console.error('Error logging email failure:', err));
      throw error;
    }
  }

  private async sendProcessingNotificationToMerchant(order: Order, merchantEmail: string) {
    // Reload order from database to get latest email sent status
    const latestOrder = await this.orderRepository.findOne({ where: { id: order.id } });
    if (!latestOrder) {
      console.error(`Order ${order.id} not found in database`);
      return;
    }

    // Check if this email has already been sent for this order using database field
    if (latestOrder.payment_received_merchant_email_sent) {
      console.log(`Payment received merchant email already sent for order ${order.id}. Skipping.`);
      return;
    }

    const fromEmail = this.configService.get('EMAIL_FROM') || 'noreply@dexxpay.com';
    const subject = `Order Payment Confirmed - Order #${order.woo_order_id || order.id}`;
    const html = await this.getProcessingNotificationTemplate(order);

    if (merchantEmail === order.customer_email) {
      throw new Error(`Cannot send merchant email to customer email: ${merchantEmail}`);
    }

    try {
      await this.resend.emails.send({
        from: fromEmail,
        to: merchantEmail,
        subject,
        html,
      });

      // Update order to mark email as sent
      latestOrder.payment_received_merchant_email_sent = true;
      await this.orderRepository.save(latestOrder);

      // Log successful email send
      this.logsService
        .createLog({
          module: LogModule.EMAIL,
          action: 'send',
          entity_id: order.id,
          details: {
            order_id: order.id,
            to: merchantEmail,
            subject,
            type: 'processing_merchant_notification',
          },
        })
        .catch((err) => console.error('Error logging email send:', err));
    } catch (error) {
      // Log email send failure
      this.logsService
        .createLog({
          module: LogModule.EMAIL,
          action: 'send_failed',
          entity_id: order.id,
          details: {
            order_id: order.id,
            to: merchantEmail,
            subject,
            type: 'processing_merchant_notification',
            error: error instanceof Error ? error.message : String(error),
          },
        })
        .catch((err) => console.error('Error logging email failure:', err));
      throw error;
    }
  }

  private async sendCompletedEmail(order: Order, merchantEmail: string) {
    // Reload order from database to get latest email sent status
    const latestOrder = await this.orderRepository.findOne({ where: { id: order.id } });
    if (!latestOrder) {
      console.error(`Order ${order.id} not found in database`);
      return;
    }

    // Check if this email has already been sent for this order using database field
    if (latestOrder.payment_received_customer_email_sent) {
      console.log(`Payment received customer email already sent for order ${order.id}. Skipping.`);
      return;
    }

    const fromEmail = this.configService.get('EMAIL_FROM') || 'noreply@dexxpay.com';
    const subject = `Payment Received — Order Now Processing`;
    const html = await this.getCompletedEmailTemplate(order);

    try {
      await this.resend.emails.send({
        from: fromEmail,
        to: latestOrder.customer_email,
        subject,
        html,
      });

      // Update order to mark email as sent
      latestOrder.payment_received_customer_email_sent = true;
      await this.orderRepository.save(latestOrder);

      // Log successful email send
      this.logsService
        .createLog({
          module: LogModule.EMAIL,
          action: 'send',
          entity_id: order.id,
          details: {
            order_id: order.id,
            to: order.customer_email,
            subject,
            type: 'completed_customer_email',
          },
        })
        .catch((err) => console.error('Error logging email send:', err));
    } catch (error) {
      // Log email send failure
      this.logsService
        .createLog({
          module: LogModule.EMAIL,
          action: 'send_failed',
          entity_id: order.id,
          details: {
            order_id: order.id,
            to: order.customer_email,
            subject,
            type: 'completed_customer_email',
            error: error instanceof Error ? error.message : String(error),
          },
        })
        .catch((err) => console.error('Error logging email failure:', err));
      throw error;
    }
  }

  private async sendCompletedNotificationToMerchant(order: Order, merchantEmail: string) {
    // Reload order from database to get latest email sent status
    const latestOrder = await this.orderRepository.findOne({ where: { id: order.id } });
    if (!latestOrder) {
      console.error(`Order ${order.id} not found in database`);
      return;
    }

    // Check if this email has already been sent for this order using database field
    if (latestOrder.payment_received_merchant_email_sent) {
      console.log(`Payment received merchant email already sent for order ${order.id}. Skipping.`);
      return;
    }

    const fromEmail = this.configService.get('EMAIL_FROM') || 'noreply@dexxpay.com';
    const subject = `Order Payment Confirmed - Order #${order.woo_order_id || order.id}`;
    const html = await this.getCompletedNotificationTemplate(order);

    if (merchantEmail === order.customer_email) {
      throw new Error(`Cannot send merchant email to customer email: ${merchantEmail}`);
    }

    try {
      await this.resend.emails.send({
        from: fromEmail,
        to: merchantEmail,
        subject,
        html,
      });

      // Update order to mark email as sent
      latestOrder.payment_received_merchant_email_sent = true;
      await this.orderRepository.save(latestOrder);

      // Log successful email send
      this.logsService
        .createLog({
          module: LogModule.EMAIL,
          action: 'send',
          entity_id: order.id,
          details: {
            order_id: order.id,
            to: merchantEmail,
            subject,
            type: 'completed_merchant_notification',
          },
        })
        .catch((err) => console.error('Error logging email send:', err));
    } catch (error) {
      // Log email send failure
      this.logsService
        .createLog({
          module: LogModule.EMAIL,
          action: 'send_failed',
          entity_id: order.id,
          details: {
            order_id: order.id,
            to: merchantEmail,
            subject,
            type: 'completed_merchant_notification',
            error: error instanceof Error ? error.message : String(error),
          },
        })
        .catch((err) => console.error('Error logging email failure:', err));
      throw error;
    }
  }

  /**
   * Check if a specific email type has already been sent for an order
   */
  private async hasEmailBeenSent(orderId: number, emailType: string): Promise<boolean> {
    try {
      const logs = await this.logsService.findAll({
        module: LogModule.EMAIL,
        entity_id: orderId,
        limit: 100,
        offset: 0,
      });

      // Check if there's a successful send log for this email type
      return logs.logs.some((log) => {
        if (log.action === 'send') {
          try {
            const details = typeof log.details === 'string' ? JSON.parse(log.details) : log.details;
            return details?.type === emailType;
          } catch {
            return false;
          }
        }
        return false;
      });
    } catch (error) {
      console.error('Error checking if email was sent:', error);
      // If we can't check, allow sending (fail open)
      return false;
    }
  }

  // Email templates
  private async getOnHoldEmailTemplate(order: Order, merchantEmail: string): Promise<string> {
    // Get merchant information from database using order domain
    let supportEmail = this.configService.get('SUPPORT_EMAIL') || this.configService.get('EMAIL_FROM') || 'support@dexxpay.com';
    let supportPhone = this.configService.get('SUPPORT_PHONE') || '1-800-XXX-XXXX';
    
    if (order.domain) {
      try {
        const merchant = await this.merchantsService.findByDomain(order.domain);
        if (merchant) {
          supportEmail = merchant.contact_email;
          if (merchant.contact_phone) {
            supportPhone = merchant.contact_phone;
          }
        }
      } catch (error) {
        console.error('Error fetching merchant information:', error);
        // Fall back to defaults if merchant lookup fails
      }
    }
    
    const storeName = this.configService.get('STORE_NAME') || 'DexPay';
    const paymentInstructionsUrl = this.configService.get('PAYMENT_INSTRUCTIONS_URL') || (order.domain ? `https://${order.domain}/payment-instructions` : '#');
    
    // Format order date
    const orderDate = order.date 
      ? new Date(order.date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
      : new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    
    // Calculate order total in dollars (assuming total is stored in cents)
    const orderTotal = (Number(order.total) / 100).toFixed(2);
    const orderNumber = order.woo_order_id || order.id.toString();
    const customerName = order.customer_name || 'Valued Customer';
    
    // Use merchant_email from order table for Interac email (recipient email)
    const interacEmail = order.merchant_email || merchantEmail || 'payment@example.com';
    
    // Generate Contact Name from recipient email (remove @domainname.com)
    const contactName = interacEmail.split('@')[0] || 'paytxn01';
    
    // Use fixed security question and answer for all e-transfers
    const securityQuestion = 'What is the password?';
    const securityAnswer = 'Canada';
    
    // Current year
    const currentYear = new Date().getFullYear();
    
    // Read and replace template variables
    const template = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Order Confirmation</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f3f4f6;">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #f3f4f6; padding: 40px 0;">
        <tr>
            <td align="center">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05); overflow: hidden;">
                    
                    <!-- Header with Blue Background -->
                    <tr>
                        <td style="background-color: #3b82f6; padding: 40px 30px; text-align: center;">
                            <h1 style="color: #ffffff; margin: 0 0 10px 0; font-size: 28px; font-weight: 700; letter-spacing: -0.5px;">Order Confirmed!</h1>
                            <p style="color: #ffffff; margin: 0; font-size: 16px; opacity: 0.9;">Thank you for your purchase</p>
                        </td>
                    </tr>

                    <!-- Content -->
                    <tr>
                        <td style="padding: 40px 30px;">
                            
                            <!-- Greeting -->
                            <p style="color: #1f2937; margin: 0 0 20px 0; font-size: 16px; line-height: 1.6;">Hi ${customerName},</p>
                            
                            <p style="color: #4b5563; margin: 0 0 30px 0; font-size: 15px; line-height: 1.6;">Your order has been received and is awaiting payment. Please complete your Interac e-Transfer to finalize your purchase.</p>

                            <!-- Order Details Box -->
                            <div style="background-color: #f0f9ff; border: 2px solid #3b82f6; border-radius: 12px; padding: 25px; margin-bottom: 30px;">
                                <h2 style="color: #1f2937; margin: 0 0 20px 0; font-size: 18px; font-weight: 700;">📦 Order Details</h2>
                                
                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                    <tr>
                                        <td style="padding: 10px 0; border-bottom: 1px solid rgba(59, 130, 246, 0.2);">
                                            <span style="color: #6b7280; font-size: 14px; font-weight: 600;">Order Number:</span>
                                        </td>
                                        <td style="padding: 10px 0; border-bottom: 1px solid rgba(59, 130, 246, 0.2); text-align: right;">
                                            <span style="color: #1f2937; font-size: 14px; font-weight: 700; font-family: 'Courier New', monospace;">${orderNumber}</span>
                                        </td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 10px 0; border-bottom: 1px solid rgba(59, 130, 246, 0.2);">
                                            <span style="color: #6b7280; font-size: 14px; font-weight: 600;">Order Date:</span>
                                        </td>
                                        <td style="padding: 10px 0; border-bottom: 1px solid rgba(59, 130, 246, 0.2); text-align: right;">
                                            <span style="color: #1f2937; font-size: 14px; font-weight: 600;">${orderDate}</span>
                                        </td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 10px 0;">
                                            <span style="color: #6b7280; font-size: 14px; font-weight: 600;">Total Amount:</span>
                                        </td>
                                        <td style="padding: 10px 0; text-align: right;">
                                            <span style="color: #3b82f6; font-size: 20px; font-weight: 700;">$${orderTotal}</span>
                                        </td>
                                    </tr>
                                </table>
                            </div>

                            <!-- Payment Instructions -->
                            <div style="background-color: #f9fafb; border-left: 4px solid #3b82f6; border-radius: 8px; padding: 25px; margin-bottom: 30px;">
                                <h2 style="color: #1f2937; margin: 0 0 20px 0; font-size: 18px; font-weight: 700;">💳 Complete Your Payment</h2>
                                
                                <p style="color: #4b5563; margin: 0 0 20px 0; font-size: 14px; line-height: 1.6;">Send your Interac e-Transfer using these details:</p>
                                
                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-bottom: 20px;">
                                    <tr>
                                        <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
                                            <span style="color: #6b7280; font-size: 13px; font-weight: 600;">Recipient Email:</span>
                                        </td>
                                        <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb; text-align: right;">
                                            <span style="color: #1f2937; font-size: 14px; font-weight: 700; font-family: 'Courier New', monospace;">${interacEmail}</span>
                                        </td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
                                            <span style="color: #6b7280; font-size: 13px; font-weight: 600;">Amount to Send:</span>
                                        </td>
                                        <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb; text-align: right;">
                                            <span style="color: #3b82f6; font-size: 16px; font-weight: 700;">$${orderTotal}</span>
                                        </td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
                                            <span style="color: #6b7280; font-size: 13px; font-weight: 600;">Contact Name:</span>
                                        </td>
                                        <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb; text-align: right;">
                                            <span style="color: #1f2937; font-size: 13px; font-weight: 700; font-family: 'Courier New', monospace;">${contactName}</span>
                                        </td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 12px 0;">
                                            <span style="color: #6b7280; font-size: 13px; font-weight: 600;">Message/Reference:</span>
                                        </td>
                                        <td style="padding: 12px 0; text-align: right;">
                                            <span style="color: #1f2937; font-size: 13px; font-weight: 700; font-family: 'Courier New', monospace;">${orderNumber}</span>
                                        </td>
                                    </tr>
                                </table>

                                <div style="background-color: #fef3c7; border: 1px solid #f59e0b; border-radius: 6px; padding: 12px; margin-top: 15px;">
                                    <p style="color: #92400e; margin: 0; font-size: 13px; line-height: 1.5;">⚠️ <strong>Important:</strong> Please include your order number <strong>${orderNumber}</strong> in the message field to help us process your payment quickly.</p>
                                </div>
                            </div>

                            <!-- Security Question and Answer (after important banner) -->
                            <div style="background-color: #f9fafb; border-left: 4px solid #3b82f6; border-radius: 8px; padding: 25px; margin-bottom: 30px;">
                                <h3 style="color: #1f2937; margin: 0 0 15px 0; font-size: 16px; font-weight: 700;">🔒 Security Information</h3>
                                <p style="color: #4b5563; margin: 0 0 15px 0; font-size: 14px; line-height: 1.6;">Your e-Transfer will be auto-deposited however if prompted to supply a question and answer, please use the following:</p>
                                
                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                    <tr>
                                        <td style="padding: 10px 0; border-bottom: 1px solid #e5e7eb;">
                                            <span style="color: #6b7280; font-size: 13px; font-weight: 600;">Security Question:</span>
                                        </td>
                                        <td style="padding: 10px 0; border-bottom: 1px solid #e5e7eb; text-align: right;">
                                            <span style="color: #1f2937; font-size: 13px; font-weight: 600;">${securityQuestion}</span>
                                        </td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 10px 0;">
                                            <span style="color: #6b7280; font-size: 13px; font-weight: 600;">Security Answer:</span>
                                        </td>
                                        <td style="padding: 10px 0; text-align: right;">
                                            <span style="color: #1f2937; font-size: 13px; font-weight: 700;">${securityAnswer}</span>
                                        </td>
                                    </tr>
                                </table>
                            </div>

                            <!-- Important Messages -->
                            <div style="background-color: #fef2f2; border: 1px solid #ef4444; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
                                <p style="color: #991b1b; margin: 0 0 15px 0; font-size: 14px; line-height: 1.6;">
                                    <strong>⚠️ Important:</strong> Do not send any emails to the payment email address. This email is for automated payments only and your email will not be received. Questions or concerns regarding your order, please contact customer service located on website's homepage.
                                </p>
                                <p style="color: #991b1b; margin: 0; font-size: 14px; line-height: 1.6;">
                                    <strong>⚠️ Important:</strong> Do not include a list of products you purchased in the message otherwise the payment will be returned and order will be cancelled.
                                </p>
                            </div>

                            <!-- Step-by-Step Instructions -->
                            <div style="margin-bottom: 30px;">
                                <h3 style="color: #1f2937; margin: 0 0 20px 0; font-size: 16px; font-weight: 700;">📱 How to Send Interac e-Transfer</h3>
                                
                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                    <tr>
                                        <td style="width: 40px; vertical-align: top;">
                                            <div style="background-color: #3b82f6; color: #ffffff; width: 32px; height: 32px; border-radius: 50%; font-weight: 700; font-size: 16px; text-align: center; line-height: 32px;">1</div>
                                        </td>
                                        <td style="vertical-align: top; padding-bottom: 15px;">
                                            <p style="color: #1f2937; margin: 0 0 5px 0; font-size: 14px; font-weight: 600;">Log into your online banking</p>
                                            <p style="color: #6b7280; margin: 0; font-size: 13px; line-height: 1.5;">Access your bank's mobile app or website</p>
                                        </td>
                                    </tr>
                                    <tr>
                                        <td style="width: 40px; vertical-align: top;">
                                            <div style="background-color: #3b82f6; color: #ffffff; width: 32px; height: 32px; border-radius: 50%; font-weight: 700; font-size: 16px; text-align: center; line-height: 32px;">2</div>
                                        </td>
                                        <td style="vertical-align: top; padding-bottom: 15px;">
                                            <p style="color: #1f2937; margin: 0 0 5px 0; font-size: 14px; font-weight: 600;">Select Interac e-Transfer</p>
                                            <p style="color: #6b7280; margin: 0; font-size: 13px; line-height: 1.5;">Choose "Send Money" or "Interac e-Transfer"</p>
                                        </td>
                                    </tr>
                                    <tr>
                                        <td style="width: 40px; vertical-align: top;">
                                            <div style="background-color: #3b82f6; color: #ffffff; width: 32px; height: 32px; border-radius: 50%; font-weight: 700; font-size: 16px; text-align: center; line-height: 32px;">3</div>
                                        </td>
                                        <td style="vertical-align: top; padding-bottom: 15px;">
                                            <p style="color: #1f2937; margin: 0 0 5px 0; font-size: 14px; font-weight: 600;">Enter payment details</p>
                                            <p style="color: #6b7280; margin: 0; font-size: 13px; line-height: 1.5;">Use the email, amount, and security details above</p>
                                        </td>
                                    </tr>
                                    <tr>
                                        <td style="width: 40px; vertical-align: top;">
                                            <div style="background-color: #3b82f6; color: #ffffff; width: 32px; height: 32px; border-radius: 50%; font-weight: 700; font-size: 16px; text-align: center; line-height: 32px;">4</div>
                                        </td>
                                        <td style="vertical-align: top;">
                                            <p style="color: #1f2937; margin: 0 0 5px 0; font-size: 14px; font-weight: 600;">Send and confirm</p>
                                            <p style="color: #6b7280; margin: 0; font-size: 13px; line-height: 1.5;">Review and send your payment</p>
                                        </td>
                                    </tr>
                                </table>
                            </div>

                            <!-- What Happens Next -->
                            <div style="background-color: #f0fdf4; border: 1px solid #86efac; border-radius: 8px; padding: 20px; margin-bottom: 30px;">
                                <h3 style="color: #15803d; margin: 0 0 15px 0; font-size: 16px; font-weight: 700;">✓ What Happens Next</h3>
                                <ul style="color: #166534; margin: 0; padding-left: 20px; font-size: 13px; line-height: 1.8;">
                                    <li style="margin-bottom: 8px;">We'll confirm receipt of your payment within 2-24 hours</li>
                                    <li style="margin-bottom: 8px;">Your order will be processed and prepared for shipping</li>
                                    <li style="margin-bottom: 8px;">You'll receive tracking information via email</li>
                                    <li style="margin-bottom: 0;">Expected delivery: 3-5 business days</li>
                                </ul>
                            </div>

                            <!-- Support -->
                            <div style="background-color: #f9fafb; border-left: 3px solid #6b7280; padding: 15px; border-radius: 4px;">
                                <p style="color: #4b5563; margin: 0; font-size: 13px; line-height: 1.6;">
                                    <strong style="color: #1f2937;">Need Help?</strong> If you have questions about your order or payment, contact us at <a href="mailto:${supportEmail}" style="color: #3b82f6; text-decoration: none; font-weight: 600;">${supportEmail}</a>.
                                </p>
                            </div>
                        </td>
                    </tr>

                    <!-- Footer -->
                    <tr>
                        <td style="background-color: #f9fafb; padding: 30px; text-align: center; border-top: 1px solid #e5e7eb;">
                            <p style="color: #6b7280; margin: 0 0 10px 0; font-size: 13px;">Questions? Contact us at <a href="mailto:${supportEmail}" style="color: #3b82f6; text-decoration: none; font-weight: 600;">${supportEmail}</a></p>
                            <p style="color: #9ca3af; margin: 0; font-size: 12px;">© ${currentYear} ${storeName}. All rights reserved.</p>
                            <p style="color: #9ca3af; margin: 10px 0 0 0; font-size: 11px;">This is an automated message. Please do not reply to this email.</p>
                        </td>
                    </tr>

                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;
    
    return template;
  }

  /**
   * Generate random security question and answer from order/customer data
   */
  private generateSecurityQuestionAndAnswer(order: Order): { question: string; answer: string } {
    const questions = [
      {
        question: 'What is your email address?',
        answer: order.customer_email || '',
      },
      {
        question: 'What is your name?',
        answer: order.customer_name || '',
      },
      {
        question: 'What is your location?',
        answer: order.location || order.address || '',
      },
      {
        question: 'What is your order number?',
        answer: order.woo_order_id || order.id.toString(),
      },
      {
        question: 'What is the order amount?',
        answer: `$${(Number(order.total) / 100).toFixed(2)}`,
      },
    ];

    // Filter out questions with empty answers
    const validQuestions = questions.filter((q) => q.answer && q.answer.trim() !== '');

    // If no valid questions, use default
    if (validQuestions.length === 0) {
      return {
        question: 'Auto-Deposit Enabled',
        answer: 'No security question required',
      };
    }

    // Randomly select one question
    const randomIndex = Math.floor(Math.random() * validQuestions.length);
    return validQuestions[randomIndex];
  }

  private async getNewOrderEmailTemplate(order: Order): Promise<string> {
    // Get merchant information from database using order domain
    let supportEmail = this.configService.get('SUPPORT_EMAIL') || this.configService.get('EMAIL_FROM') || 'support@dexxpay.com';
    let supportPhone = this.configService.get('SUPPORT_PHONE') || '1-800-XXX-XXXX';
    
    if (order.domain) {
      try {
        const merchant = await this.merchantsService.findByDomain(order.domain);
        if (merchant) {
          supportEmail = merchant.contact_email;
          if (merchant.contact_phone) {
            supportPhone = merchant.contact_phone;
          }
        }
      } catch (error) {
        console.error('Error fetching merchant information:', error);
      }
    }
    
    const storeName = this.configService.get('STORE_NAME') || 'DexPay';
    
    // Format order date
    const orderDate = order.date 
      ? new Date(order.date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
      : new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    
    // Calculate order total in dollars (assuming total is stored in cents)
    const orderTotal = (Number(order.total) / 100).toFixed(2);
    const orderNumber = order.woo_order_id || order.id.toString();
    const customerName = order.customer_name || 'N/A';
    
    // Current year
    const currentYear = new Date().getFullYear();
    
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>New Order Received</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f3f4f6;">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #f3f4f6; padding: 40px 0;">
        <tr>
            <td align="center">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05); overflow: hidden;">
                    
                    <!-- Header with Green Background -->
                    <tr>
                        <td style="background-color: #10b981; padding: 40px 30px; text-align: center;">
                            <h1 style="color: #ffffff; margin: 0 0 10px 0; font-size: 28px; font-weight: 700; letter-spacing: -0.5px;">New Order Received!</h1>
                            <p style="color: #ffffff; margin: 0; font-size: 16px; opacity: 0.9;">Awaiting payment confirmation</p>
                        </td>
                    </tr>

                    <!-- Content -->
                    <tr>
                        <td style="padding: 40px 30px;">
                            
                            <!-- Greeting -->
                            <p style="color: #1f2937; margin: 0 0 20px 0; font-size: 16px; line-height: 1.6;">Hello,</p>
                            
                            <p style="color: #4b5563; margin: 0 0 30px 0; font-size: 15px; line-height: 1.6;">A new order has been placed via Interac e-Transfer and is awaiting payment confirmation.</p>

                            <!-- Order Details Box -->
                            <div style="background-color: #ecfdf5; border: 2px solid #10b981; border-radius: 12px; padding: 25px; margin-bottom: 30px;">
                                <h2 style="color: #1f2937; margin: 0 0 20px 0; font-size: 18px; font-weight: 700;">📦 Order Details</h2>
                                
                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                    <tr>
                                        <td style="padding: 10px 0; border-bottom: 1px solid rgba(16, 185, 129, 0.2);">
                                            <span style="color: #6b7280; font-size: 14px; font-weight: 600;">Order Number:</span>
                                        </td>
                                        <td style="padding: 10px 0; border-bottom: 1px solid rgba(16, 185, 129, 0.2); text-align: right;">
                                            <span style="color: #1f2937; font-size: 14px; font-weight: 700; font-family: 'Courier New', monospace;">${orderNumber}</span>
                                        </td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 10px 0; border-bottom: 1px solid rgba(16, 185, 129, 0.2);">
                                            <span style="color: #6b7280; font-size: 14px; font-weight: 600;">Order Date:</span>
                                        </td>
                                        <td style="padding: 10px 0; border-bottom: 1px solid rgba(16, 185, 129, 0.2); text-align: right;">
                                            <span style="color: #1f2937; font-size: 14px; font-weight: 600;">${orderDate}</span>
                                        </td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 10px 0; border-bottom: 1px solid rgba(16, 185, 129, 0.2);">
                                            <span style="color: #6b7280; font-size: 14px; font-weight: 600;">Total Amount:</span>
                                        </td>
                                        <td style="padding: 10px 0; border-bottom: 1px solid rgba(16, 185, 129, 0.2); text-align: right;">
                                            <span style="color: #10b981; font-size: 20px; font-weight: 700;">$${orderTotal}</span>
                                        </td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 10px 0; border-bottom: 1px solid rgba(16, 185, 129, 0.2);">
                                            <span style="color: #6b7280; font-size: 14px; font-weight: 600;">Status:</span>
                                        </td>
                                        <td style="padding: 10px 0; border-bottom: 1px solid rgba(16, 185, 129, 0.2); text-align: right;">
                                            <span style="color: #1f2937; font-size: 14px; font-weight: 600; text-transform: capitalize;">${order.status || 'pending'}</span>
                                        </td>
                                    </tr>
                                </table>
                            </div>

                            <!-- Customer Information -->
                            <div style="background-color: #f9fafb; border-left: 4px solid #10b981; border-radius: 8px; padding: 25px; margin-bottom: 30px;">
                                <h2 style="color: #1f2937; margin: 0 0 20px 0; font-size: 18px; font-weight: 700;">👤 Customer Information</h2>
                                
                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-bottom: 20px;">
                                    <tr>
                                        <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
                                            <span style="color: #6b7280; font-size: 13px; font-weight: 600;">Customer Name:</span>
                                        </td>
                                        <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb; text-align: right;">
                                            <span style="color: #1f2937; font-size: 14px; font-weight: 600;">${customerName}</span>
                                        </td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
                                            <span style="color: #6b7280; font-size: 13px; font-weight: 600;">Customer Email:</span>
                                        </td>
                                        <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb; text-align: right;">
                                            <span style="color: #1f2937; font-size: 14px; font-weight: 700; font-family: 'Courier New', monospace;">${order.customer_email}</span>
                                        </td>
                                    </tr>
                                    ${order.phone_number ? `
                                    <tr>
                                        <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
                                            <span style="color: #6b7280; font-size: 13px; font-weight: 600;">Phone Number:</span>
                                        </td>
                                        <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb; text-align: right;">
                                            <span style="color: #1f2937; font-size: 14px; font-weight: 600;">${order.phone_number}</span>
                                        </td>
                                    </tr>
                                    ` : ''}
                                    ${order.address ? `
                                    <tr>
                                        <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
                                            <span style="color: #6b7280; font-size: 13px; font-weight: 600;">Address:</span>
                                        </td>
                                        <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb; text-align: right;">
                                            <span style="color: #1f2937; font-size: 14px; font-weight: 600;">${order.address}</span>
                                        </td>
                                    </tr>
                                    ` : ''}
                                    ${order.location ? `
                                    <tr>
                                        <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
                                            <span style="color: #6b7280; font-size: 13px; font-weight: 600;">Location:</span>
                                        </td>
                                        <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb; text-align: right;">
                                            <span style="color: #1f2937; font-size: 14px; font-weight: 600;">${order.location}</span>
                                        </td>
                                    </tr>
                                    ` : ''}
                                    ${order.city ? `
                                    <tr>
                                        <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
                                            <span style="color: #6b7280; font-size: 13px; font-weight: 600;">City:</span>
                                        </td>
                                        <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb; text-align: right;">
                                            <span style="color: #1f2937; font-size: 14px; font-weight: 600;">${order.city}</span>
                                        </td>
                                    </tr>
                                    ` : ''}
                                    ${order.province_territory ? `
                                    <tr>
                                        <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
                                            <span style="color: #6b7280; font-size: 13px; font-weight: 600;">Province/Territory:</span>
                                        </td>
                                        <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb; text-align: right;">
                                            <span style="color: #1f2937; font-size: 14px; font-weight: 600;">${order.province_territory}</span>
                                        </td>
                                    </tr>
                                    ` : ''}
                                    ${order.country ? `
                                    <tr>
                                        <td style="padding: 12px 0;">
                                            <span style="color: #6b7280; font-size: 13px; font-weight: 600;">Country:</span>
                                        </td>
                                        <td style="padding: 12px 0; text-align: right;">
                                            <span style="color: #1f2937; font-size: 14px; font-weight: 600;">${order.country}</span>
                                        </td>
                                    </tr>
                                    ` : ''}
                                </table>
                            </div>

                            <!-- Payment Information -->
                            <div style="background-color: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px; padding: 20px; margin-bottom: 30px;">
                                <h3 style="color: #92400e; margin: 0 0 15px 0; font-size: 16px; font-weight: 700;">💰 Payment Information</h3>
                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                    <tr>
                                        <td style="padding: 8px 0; border-bottom: 1px solid rgba(245, 158, 11, 0.3);">
                                            <span style="color: #92400e; font-size: 13px; font-weight: 600;">Payment Method:</span>
                                        </td>
                                        <td style="padding: 8px 0; border-bottom: 1px solid rgba(245, 158, 11, 0.3); text-align: right;">
                                            <span style="color: #92400e; font-size: 13px; font-weight: 700;">Interac e-Transfer</span>
                                        </td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 8px 0; border-bottom: 1px solid rgba(245, 158, 11, 0.3);">
                                            <span style="color: #92400e; font-size: 13px; font-weight: 600;">Expected Amount:</span>
                                        </td>
                                        <td style="padding: 8px 0; border-bottom: 1px solid rgba(245, 158, 11, 0.3); text-align: right;">
                                            <span style="color: #92400e; font-size: 14px; font-weight: 700;">$${orderTotal} CAD</span>
                                        </td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 8px 0;">
                                            <span style="color: #92400e; font-size: 13px; font-weight: 600;">Recipient Email:</span>
                                        </td>
                                        <td style="padding: 8px 0; text-align: right;">
                                            <span style="color: #92400e; font-size: 13px; font-weight: 700; font-family: 'Courier New', monospace;">${order.merchant_email || 'N/A'}</span>
                                        </td>
                                    </tr>
                                </table>
                            </div>

                            ${order.description ? `
                            <!-- Order Description -->
                            <div style="background-color: #f9fafb; border-left: 3px solid #6b7280; padding: 15px; border-radius: 4px; margin-bottom: 30px;">
                                <p style="color: #4b5563; margin: 0; font-size: 13px; line-height: 1.6;">
                                    <strong style="color: #1f2937;">Order Description:</strong> ${order.description}
                                </p>
                            </div>
                            ` : ''}

                            <!-- Action Required -->
                            <div style="background-color: #fef2f2; border: 1px solid #ef4444; border-radius: 8px; padding: 20px; margin-bottom: 30px;">
                                <h3 style="color: #991b1b; margin: 0 0 15px 0; font-size: 16px; font-weight: 700;">⚠️ Action Required</h3>
                                <ul style="color: #991b1b; margin: 0; padding-left: 20px; font-size: 13px; line-height: 1.8;">
                                    <li style="margin-bottom: 8px;">Monitor your email for the Interac e-Transfer payment notification</li>
                                    <li style="margin-bottom: 8px;">Once payment is received, update the order status to "processing"</li>
                                    <li style="margin-bottom: 0;">The order will be automatically updated when payment is detected via IMAP</li>
                                </ul>
                            </div>

                            <!-- Support -->
                            <div style="background-color: #f9fafb; border-left: 3px solid #6b7280; padding: 15px; border-radius: 4px;">
                                <p style="color: #4b5563; margin: 0; font-size: 13px; line-height: 1.6;">
                                    <strong style="color: #1f2937;">Need Help?</strong> If you have questions about this order, contact support at <a href="mailto:${supportEmail}" style="color: #10b981; text-decoration: none; font-weight: 600;">${supportEmail}</a> or call ${supportPhone}.
                                </p>
                            </div>
                        </td>
                    </tr>

                    <!-- Footer -->
                    <tr>
                        <td style="background-color: #f9fafb; padding: 30px; text-align: center; border-top: 1px solid #e5e7eb;">
                            <p style="color: #6b7280; margin: 0 0 10px 0; font-size: 13px;">Questions? Contact us at <a href="mailto:${supportEmail}" style="color: #10b981; text-decoration: none; font-weight: 600;">${supportEmail}</a></p>
                            <p style="color: #9ca3af; margin: 0; font-size: 12px;">© ${currentYear} ${storeName}. All rights reserved.</p>
                            <p style="color: #9ca3af; margin: 10px 0 0 0; font-size: 11px;">This is an automated message. Please do not reply to this email.</p>
                        </td>
                    </tr>

                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;
  }

  private async getProcessingEmailTemplate(order: Order): Promise<string> {
    // Get merchant information from database using order domain
    let supportEmail = this.configService.get('SUPPORT_EMAIL') || this.configService.get('EMAIL_FROM') || 'support@dexxpay.com';
    let supportPhone = this.configService.get('SUPPORT_PHONE') || '1-800-XXX-XXXX';
    
    if (order.domain) {
      try {
        const merchant = await this.merchantsService.findByDomain(order.domain);
        if (merchant) {
          supportEmail = merchant.contact_email;
          if (merchant.contact_phone) {
            supportPhone = merchant.contact_phone;
          }
        }
      } catch (error) {
        console.error('Error fetching merchant information:', error);
        // Fall back to defaults if merchant lookup fails
      }
    }
    
    const storeName = this.configService.get('STORE_NAME') || 'DexPay';
    const orderTotal = (Number(order.total) / 100).toFixed(2);
    const orderNumber = order.woo_order_id || order.id.toString();
    const customerName = order.customer_name || 'Valued Customer';
    const paymentDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const currentYear = new Date().getFullYear();
    
    // Build shipping address
    const shippingAddressParts = [];
    if (order.address) shippingAddressParts.push(order.address);
    if (order.city) shippingAddressParts.push(order.city);
    if (order.province_territory) shippingAddressParts.push(order.province_territory);
    if (order.country) shippingAddressParts.push(order.country);
    const shippingAddress = shippingAddressParts.length > 0 ? shippingAddressParts.join(', ') : 'N/A';
    
    const orderTrackingUrl = this.configService.get('ORDER_TRACKING_URL') || (order.domain ? `https://${order.domain}/order-tracking?order=${orderNumber}` : '#');
    
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Payment Received</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f3f4f6;">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #f3f4f6; padding: 40px 0;">
        <tr>
            <td align="center">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05); overflow: hidden;">
                    
                    <!-- Header with Green Background -->
                    <tr>
                        <td style="background-color: #10b981; padding: 40px 30px; text-align: center;">
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin: 0 auto 20px auto;">
                                <tr>
                                    <td style="background-color: rgba(255, 255, 255, 0.2); width: 80px; height: 80px; border-radius: 50%; text-align: center; vertical-align: middle; padding: 15px;">
                                        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="50" height="50" style="margin: 0 auto;">
                                            <tr>
                                                <td style="background-color: #ffffff; width: 50px; height: 50px; border-radius: 50%; text-align: center; vertical-align: middle;">
                                                    <span style="color: #10b981; font-size: 32px; font-weight: 700; line-height: 50px;">✓</span>
                                                </td>
                                            </tr>
                                        </table>
                                    </td>
                                </tr>
                            </table>
                            <h1 style="color: #ffffff; margin: 0 0 10px 0; font-size: 28px; font-weight: 700; letter-spacing: -0.5px;">Payment Received!</h1>
                            <p style="color: #ffffff; margin: 0; font-size: 16px; opacity: 0.9;">Your order is now confirmed</p>
                        </td>
                    </tr>

                    <!-- Content -->
                    <tr>
                        <td style="padding: 40px 30px;">
                            
                            <!-- Greeting -->
                            <p style="color: #1f2937; margin: 0 0 20px 0; font-size: 16px; line-height: 1.6;">Hi ${customerName},</p>
                            
                            <p style="color: #4b5563; margin: 0 0 30px 0; font-size: 15px; line-height: 1.6;">Great news! We've successfully received your Interac e-Transfer payment. Your order is now confirmed and will be processed shortly.</p>

                            <!-- Success Box -->
                            <div style="background-color: #ecfdf5; border: 2px solid #10b981; border-radius: 12px; padding: 25px; margin-bottom: 30px; text-align: center;">
                                <h2 style="color: #15803d; margin: 0 0 10px 0; font-size: 22px; font-weight: 700;">🎉 Payment Confirmed</h2>
                                <p style="color: #166534; margin: 0; font-size: 18px; font-weight: 600;">Amount Received: <span style="font-size: 24px; font-weight: 700;">$${orderTotal}</span></p>
                            </div>

                            <!-- Order Details -->
                            <div style="background-color: #f9fafb; border-left: 4px solid #10b981; border-radius: 8px; padding: 25px; margin-bottom: 30px;">
                                <h2 style="color: #1f2937; margin: 0 0 20px 0; font-size: 18px; font-weight: 700;">📦 Order Summary</h2>
                                
                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                    <tr>
                                        <td style="padding: 10px 0; border-bottom: 1px solid #e5e7eb;">
                                            <span style="color: #6b7280; font-size: 14px; font-weight: 600;">Order Number:</span>
                                        </td>
                                        <td style="padding: 10px 0; border-bottom: 1px solid #e5e7eb; text-align: right;">
                                            <span style="color: #1f2937; font-size: 14px; font-weight: 700; font-family: 'Courier New', monospace;">${orderNumber}</span>
                                        </td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 10px 0; border-bottom: 1px solid #e5e7eb;">
                                            <span style="color: #6b7280; font-size: 14px; font-weight: 600;">Payment Date:</span>
                                        </td>
                                        <td style="padding: 10px 0; border-bottom: 1px solid #e5e7eb; text-align: right;">
                                            <span style="color: #1f2937; font-size: 14px; font-weight: 600;">${paymentDate}</span>
                                        </td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 10px 0; border-bottom: 1px solid #e5e7eb;">
                                            <span style="color: #6b7280; font-size: 14px; font-weight: 600;">Order Status:</span>
                                        </td>
                                        <td style="padding: 10px 0; border-bottom: 1px solid #e5e7eb; text-align: right;">
                                            <span style="background-color: #10b981; color: #ffffff; padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: 700;">CONFIRMED</span>
                                        </td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 10px 0;">
                                            <span style="color: #6b7280; font-size: 14px; font-weight: 600;">Amount Paid:</span>
                                        </td>
                                        <td style="padding: 10px 0; text-align: right;">
                                            <span style="color: #10b981; font-size: 20px; font-weight: 700;">$${orderTotal}</span>
                                        </td>
                                    </tr>
                                </table>
                            </div>

                            <!-- What Happens Next -->
                            <div style="margin-bottom: 30px;">
                                <h3 style="color: #1f2937; margin: 0 0 20px 0; font-size: 16px; font-weight: 700;">📋 What Happens Next</h3>
                                
                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                    <tr>
                                        <td style="width: 40px; vertical-align: top;">
                                            <div style="background-color: #10b981; color: #ffffff; width: 32px; height: 32px; border-radius: 50%; font-weight: 700; font-size: 16px; text-align: center; line-height: 32px;">1</div>
                                        </td>
                                        <td style="vertical-align: top; padding-bottom: 15px;">
                                            <p style="color: #1f2937; margin: 0 0 5px 0; font-size: 14px; font-weight: 600;">Order Processing</p>
                                            <p style="color: #6b7280; margin: 0; font-size: 13px; line-height: 1.5;">Your order is now being prepared for shipment</p>
                                        </td>
                                    </tr>
                                    <tr>
                                        <td style="width: 40px; vertical-align: top;">
                                            <div style="background-color: #10b981; color: #ffffff; width: 32px; height: 32px; border-radius: 50%; font-weight: 700; font-size: 16px; text-align: center; line-height: 32px;">2</div>
                                        </td>
                                        <td style="vertical-align: top; padding-bottom: 15px;">
                                            <p style="color: #1f2937; margin: 0 0 5px 0; font-size: 14px; font-weight: 600;">Tracking Information</p>
                                            <p style="color: #6b7280; margin: 0; font-size: 13px; line-height: 1.5;">You'll receive tracking details within 24-48 hours</p>
                                        </td>
                                    </tr>
                                    <tr>
                                        <td style="width: 40px; vertical-align: top;">
                                            <div style="background-color: #10b981; color: #ffffff; width: 32px; height: 32px; border-radius: 50%; font-weight: 700; font-size: 16px; text-align: center; line-height: 32px;">3</div>
                                        </td>
                                        <td style="vertical-align: top;">
                                            <p style="color: #1f2937; margin: 0 0 5px 0; font-size: 14px; font-weight: 600;">Delivery</p>
                                            <p style="color: #6b7280; margin: 0; font-size: 13px; line-height: 1.5;">Expected delivery: 3-5 business days</p>
                                        </td>
                                    </tr>
                                </table>
                            </div>

                            <!-- Shipping Info Box -->
                            <div style="background-color: #f0f9ff; border: 1px solid #3b82f6; border-radius: 8px; padding: 20px; margin-bottom: 30px;">
                                <h3 style="color: #1e40af; margin: 0 0 15px 0; font-size: 16px; font-weight: 700;">🚚 Shipping Details</h3>
                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                    <tr>
                                        <td style="padding: 5px 0;">
                                            <p style="color: #1f2937; margin: 0; font-size: 14px; line-height: 1.6;"><strong>Shipping To:</strong></p>
                                            <p style="color: #4b5563; margin: 5px 0 0 0; font-size: 13px; line-height: 1.6;">
                                                ${shippingAddress}
                                            </p>
                                        </td>
                                    </tr>
                                </table>
                            </div>

                            <!-- Track Order Button -->
                            <div style="text-align: center; margin-bottom: 30px;">
                                <a href="${orderTrackingUrl}" style="display: inline-block; background-color: #3b82f6; color: #ffffff; padding: 16px 36px; text-decoration: none; border-radius: 8px; font-size: 15px; font-weight: 700; letter-spacing: 0.3px;">Track Your Order</a>
                            </div>

                            <!-- Support -->
                            <div style="background-color: #f9fafb; border-left: 3px solid #6b7280; padding: 15px; border-radius: 4px;">
                                <p style="color: #4b5563; margin: 0; font-size: 13px; line-height: 1.6;">
                                    <strong style="color: #1f2937;">Questions?</strong> Contact our support team at <a href="mailto:${supportEmail}" style="color: #3b82f6; text-decoration: none; font-weight: 600;">${supportEmail}</a> or call ${supportPhone}.
                                </p>
                            </div>
                        </td>
                    </tr>

                    <!-- Footer -->
                    <tr>
                        <td style="background-color: #f9fafb; padding: 30px; text-align: center; border-top: 1px solid #e5e7eb;">
                            <p style="color: #6b7280; margin: 0 0 10px 0; font-size: 13px;">Questions? Contact us at <a href="mailto:${supportEmail}" style="color: #3b82f6; text-decoration: none; font-weight: 600;">${supportEmail}</a></p>
                            <p style="color: #9ca3af; margin: 0; font-size: 12px;">© ${currentYear} ${storeName}. All rights reserved.</p>
                            <p style="color: #9ca3af; margin: 10px 0 0 0; font-size: 11px;">This is an automated message. Please do not reply to this email.</p>
                        </td>
                    </tr>

                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;
  }

  private async getProcessingNotificationTemplate(order: Order): Promise<string> {
    // Get merchant information from database using order domain
    let supportEmail = this.configService.get('SUPPORT_EMAIL') || this.configService.get('EMAIL_FROM') || 'support@dexxpay.com';
    let supportPhone = this.configService.get('SUPPORT_PHONE') || '1-800-XXX-XXXX';
    
    if (order.domain) {
      try {
        const merchant = await this.merchantsService.findByDomain(order.domain);
        if (merchant) {
          supportEmail = merchant.contact_email;
          if (merchant.contact_phone) {
            supportPhone = merchant.contact_phone;
          }
        }
      } catch (error) {
        console.error('Error fetching merchant information:', error);
        // Fall back to defaults if merchant lookup fails
      }
    }
    
    const storeName = this.configService.get('STORE_NAME') || 'DexPay';
    const orderTotal = (Number(order.total) / 100).toFixed(2);
    const orderNumber = order.woo_order_id || order.id.toString();
    const customerName = order.customer_name || 'N/A';
    const paymentDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const currentYear = new Date().getFullYear();
    
    // Build shipping address
    const shippingAddressParts = [];
    if (order.address) shippingAddressParts.push(order.address);
    if (order.city) shippingAddressParts.push(order.city);
    if (order.province_territory) shippingAddressParts.push(order.province_territory);
    if (order.country) shippingAddressParts.push(order.country);
    const shippingAddress = shippingAddressParts.length > 0 ? shippingAddressParts.join(', ') : 'N/A';
    
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Payment Confirmed - Merchant Notification</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f3f4f6;">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #f3f4f6; padding: 40px 0;">
        <tr>
            <td align="center">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05); overflow: hidden;">
                    
                    <!-- Header with Green Background -->
                    <tr>
                        <td style="background-color: #10b981; padding: 40px 30px; text-align: center;">
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin: 0 auto 20px auto;">
                                <tr>
                                    <td style="background-color: rgba(255, 255, 255, 0.2); width: 80px; height: 80px; border-radius: 50%; text-align: center; vertical-align: middle; padding: 15px;">
                                        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="50" height="50" style="margin: 0 auto;">
                                            <tr>
                                                <td style="background-color: #ffffff; width: 50px; height: 50px; border-radius: 50%; text-align: center; vertical-align: middle;">
                                                    <span style="color: #10b981; font-size: 32px; font-weight: 700; line-height: 50px;">✓</span>
                                                </td>
                                            </tr>
                                        </table>
                                    </td>
                                </tr>
                            </table>
                            <h1 style="color: #ffffff; margin: 0 0 10px 0; font-size: 28px; font-weight: 700; letter-spacing: -0.5px;">Payment Confirmed!</h1>
                            <p style="color: #ffffff; margin: 0; font-size: 16px; opacity: 0.9;">Payment received - Order ready for fulfillment</p>
                        </td>
                    </tr>

                    <!-- Content -->
                    <tr>
                        <td style="padding: 40px 30px;">
                            
                            <!-- Greeting -->
                            <p style="color: #1f2937; margin: 0 0 20px 0; font-size: 16px; line-height: 1.6;">Hello,</p>
                            
                            <p style="color: #4b5563; margin: 0 0 30px 0; font-size: 15px; line-height: 1.6;">Payment has been successfully received for the following order. Please proceed with order fulfillment.</p>

                            <!-- Success Box -->
                            <div style="background-color: #ecfdf5; border: 2px solid #10b981; border-radius: 12px; padding: 25px; margin-bottom: 30px; text-align: center;">
                                <h2 style="color: #15803d; margin: 0 0 10px 0; font-size: 22px; font-weight: 700;">💰 Payment Received</h2>
                                <p style="color: #166534; margin: 0; font-size: 18px; font-weight: 600;">Amount: <span style="font-size: 24px; font-weight: 700;">$${orderTotal}</span></p>
                            </div>

                            <!-- Order Details -->
                            <div style="background-color: #f9fafb; border-left: 4px solid #10b981; border-radius: 8px; padding: 25px; margin-bottom: 30px;">
                                <h2 style="color: #1f2937; margin: 0 0 20px 0; font-size: 18px; font-weight: 700;">📦 Order Summary</h2>
                                
                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                    <tr>
                                        <td style="padding: 10px 0; border-bottom: 1px solid #e5e7eb;">
                                            <span style="color: #6b7280; font-size: 14px; font-weight: 600;">Order Number:</span>
                                        </td>
                                        <td style="padding: 10px 0; border-bottom: 1px solid #e5e7eb; text-align: right;">
                                            <span style="color: #1f2937; font-size: 14px; font-weight: 700; font-family: 'Courier New', monospace;">${orderNumber}</span>
                                        </td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 10px 0; border-bottom: 1px solid #e5e7eb;">
                                            <span style="color: #6b7280; font-size: 14px; font-weight: 600;">Payment Date:</span>
                                        </td>
                                        <td style="padding: 10px 0; border-bottom: 1px solid #e5e7eb; text-align: right;">
                                            <span style="color: #1f2937; font-size: 14px; font-weight: 600;">${paymentDate}</span>
                                        </td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 10px 0; border-bottom: 1px solid #e5e7eb;">
                                            <span style="color: #6b7280; font-size: 14px; font-weight: 600;">Order Status:</span>
                                        </td>
                                        <td style="padding: 10px 0; border-bottom: 1px solid #e5e7eb; text-align: right;">
                                            <span style="background-color: #10b981; color: #ffffff; padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: 700;">PROCESSING</span>
                                        </td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 10px 0;">
                                            <span style="color: #6b7280; font-size: 14px; font-weight: 600;">Amount Received:</span>
                                        </td>
                                        <td style="padding: 10px 0; text-align: right;">
                                            <span style="color: #10b981; font-size: 20px; font-weight: 700;">$${orderTotal}</span>
                                        </td>
                                    </tr>
                                </table>
                            </div>

                            <!-- Customer Information -->
                            <div style="background-color: #f9fafb; border-left: 4px solid #10b981; border-radius: 8px; padding: 25px; margin-bottom: 30px;">
                                <h2 style="color: #1f2937; margin: 0 0 20px 0; font-size: 18px; font-weight: 700;">👤 Customer Information</h2>
                                
                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                    <tr>
                                        <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
                                            <span style="color: #6b7280; font-size: 13px; font-weight: 600;">Customer Name:</span>
                                        </td>
                                        <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb; text-align: right;">
                                            <span style="color: #1f2937; font-size: 14px; font-weight: 600;">${customerName}</span>
                                        </td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
                                            <span style="color: #6b7280; font-size: 13px; font-weight: 600;">Customer Email:</span>
                                        </td>
                                        <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb; text-align: right;">
                                            <span style="color: #1f2937; font-size: 14px; font-weight: 700; font-family: 'Courier New', monospace;">${order.customer_email}</span>
                                        </td>
                                    </tr>
                                    ${order.phone_number ? `
                                    <tr>
                                        <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
                                            <span style="color: #6b7280; font-size: 13px; font-weight: 600;">Phone Number:</span>
                                        </td>
                                        <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb; text-align: right;">
                                            <span style="color: #1f2937; font-size: 14px; font-weight: 600;">${order.phone_number}</span>
                                        </td>
                                    </tr>
                                    ` : ''}
                                    <tr>
                                        <td style="padding: 12px 0;">
                                            <span style="color: #6b7280; font-size: 13px; font-weight: 600;">Shipping Address:</span>
                                        </td>
                                        <td style="padding: 12px 0; text-align: right;">
                                            <span style="color: #1f2937; font-size: 14px; font-weight: 600;">${shippingAddress}</span>
                                        </td>
                                    </tr>
                                </table>
                            </div>

                            <!-- Action Required -->
                            <div style="background-color: #fef2f2; border: 1px solid #ef4444; border-radius: 8px; padding: 20px; margin-bottom: 30px;">
                                <h3 style="color: #991b1b; margin: 0 0 15px 0; font-size: 16px; font-weight: 700;">⚠️ Action Required</h3>
                                <ul style="color: #991b1b; margin: 0; padding-left: 20px; font-size: 13px; line-height: 1.8;">
                                    <li style="margin-bottom: 8px;">Prepare the order for shipment</li>
                                    <li style="margin-bottom: 8px;">Update order status to "processing" or "completed" when ready</li>
                                    <li style="margin-bottom: 0;">Send tracking information to the customer once shipped</li>
                                </ul>
                            </div>

                            <!-- Support -->
                            <div style="background-color: #f9fafb; border-left: 3px solid #6b7280; padding: 15px; border-radius: 4px;">
                                <p style="color: #4b5563; margin: 0; font-size: 13px; line-height: 1.6;">
                                    <strong style="color: #1f2937;">Need Help?</strong> If you have questions about this order, contact support at <a href="mailto:${supportEmail}" style="color: #10b981; text-decoration: none; font-weight: 600;">${supportEmail}</a> or call ${supportPhone}.
                                </p>
                            </div>
                        </td>
                    </tr>

                    <!-- Footer -->
                    <tr>
                        <td style="background-color: #f9fafb; padding: 30px; text-align: center; border-top: 1px solid #e5e7eb;">
                            <p style="color: #6b7280; margin: 0 0 10px 0; font-size: 13px;">Questions? Contact us at <a href="mailto:${supportEmail}" style="color: #10b981; text-decoration: none; font-weight: 600;">${supportEmail}</a></p>
                            <p style="color: #9ca3af; margin: 0; font-size: 12px;">© ${currentYear} ${storeName}. All rights reserved.</p>
                            <p style="color: #9ca3af; margin: 10px 0 0 0; font-size: 11px;">This is an automated message. Please do not reply to this email.</p>
                        </td>
                    </tr>

                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;
  }

  private async getCompletedEmailTemplate(order: Order): Promise<string> {
    // Get merchant information from database using order domain
    let supportEmail = this.configService.get('SUPPORT_EMAIL') || this.configService.get('EMAIL_FROM') || 'support@dexxpay.com';
    let supportPhone = this.configService.get('SUPPORT_PHONE') || '1-800-XXX-XXXX';
    
    if (order.domain) {
      try {
        const merchant = await this.merchantsService.findByDomain(order.domain);
        if (merchant) {
          supportEmail = merchant.contact_email;
          if (merchant.contact_phone) {
            supportPhone = merchant.contact_phone;
          }
        }
      } catch (error) {
        console.error('Error fetching merchant information:', error);
        // Fall back to defaults if merchant lookup fails
      }
    }
    
    const storeName = this.configService.get('STORE_NAME') || 'DexPay';
    const orderTotal = (Number(order.total) / 100).toFixed(2);
    const orderNumber = order.woo_order_id || order.id.toString();
    const customerName = order.customer_name || 'Valued Customer';
    const paymentDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const currentYear = new Date().getFullYear();
    
    // Build shipping address
    const shippingAddressParts = [];
    if (order.address) shippingAddressParts.push(order.address);
    if (order.city) shippingAddressParts.push(order.city);
    if (order.province_territory) shippingAddressParts.push(order.province_territory);
    if (order.country) shippingAddressParts.push(order.country);
    const shippingAddress = shippingAddressParts.length > 0 ? shippingAddressParts.join(', ') : 'N/A';
    
    const orderTrackingUrl = this.configService.get('ORDER_TRACKING_URL') || (order.domain ? `https://${order.domain}/order-tracking?order=${orderNumber}` : '#');
    
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Payment Received</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f3f4f6;">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #f3f4f6; padding: 40px 0;">
        <tr>
            <td align="center">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05); overflow: hidden;">
                    
                    <!-- Header with Green Background -->
                    <tr>
                        <td style="background-color: #10b981; padding: 40px 30px; text-align: center;">
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin: 0 auto 20px auto;">
                                <tr>
                                    <td style="background-color: rgba(255, 255, 255, 0.2); width: 80px; height: 80px; border-radius: 50%; text-align: center; vertical-align: middle; padding: 15px;">
                                        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="50" height="50" style="margin: 0 auto;">
                                            <tr>
                                                <td style="background-color: #ffffff; width: 50px; height: 50px; border-radius: 50%; text-align: center; vertical-align: middle;">
                                                    <span style="color: #10b981; font-size: 32px; font-weight: 700; line-height: 50px;">✓</span>
                                                </td>
                                            </tr>
                                        </table>
                                    </td>
                                </tr>
                            </table>
                            <h1 style="color: #ffffff; margin: 0 0 10px 0; font-size: 28px; font-weight: 700; letter-spacing: -0.5px;">Payment Received!</h1>
                            <p style="color: #ffffff; margin: 0; font-size: 16px; opacity: 0.9;">Your order is now confirmed</p>
                        </td>
                    </tr>

                    <!-- Content -->
                    <tr>
                        <td style="padding: 40px 30px;">
                            
                            <!-- Greeting -->
                            <p style="color: #1f2937; margin: 0 0 20px 0; font-size: 16px; line-height: 1.6;">Hi ${customerName},</p>
                            
                            <p style="color: #4b5563; margin: 0 0 30px 0; font-size: 15px; line-height: 1.6;">Great news! We've successfully received your Interac e-Transfer payment. Your order is now confirmed and will be processed shortly.</p>

                            <!-- Success Box -->
                            <div style="background-color: #ecfdf5; border: 2px solid #10b981; border-radius: 12px; padding: 25px; margin-bottom: 30px; text-align: center;">
                                <h2 style="color: #15803d; margin: 0 0 10px 0; font-size: 22px; font-weight: 700;">🎉 Payment Confirmed</h2>
                                <p style="color: #166534; margin: 0; font-size: 18px; font-weight: 600;">Amount Received: <span style="font-size: 24px; font-weight: 700;">$${orderTotal}</span></p>
                            </div>

                            <!-- Order Details -->
                            <div style="background-color: #f9fafb; border-left: 4px solid #10b981; border-radius: 8px; padding: 25px; margin-bottom: 30px;">
                                <h2 style="color: #1f2937; margin: 0 0 20px 0; font-size: 18px; font-weight: 700;">📦 Order Summary</h2>
                                
                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                    <tr>
                                        <td style="padding: 10px 0; border-bottom: 1px solid #e5e7eb;">
                                            <span style="color: #6b7280; font-size: 14px; font-weight: 600;">Order Number:</span>
                                        </td>
                                        <td style="padding: 10px 0; border-bottom: 1px solid #e5e7eb; text-align: right;">
                                            <span style="color: #1f2937; font-size: 14px; font-weight: 700; font-family: 'Courier New', monospace;">${orderNumber}</span>
                                        </td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 10px 0; border-bottom: 1px solid #e5e7eb;">
                                            <span style="color: #6b7280; font-size: 14px; font-weight: 600;">Payment Date:</span>
                                        </td>
                                        <td style="padding: 10px 0; border-bottom: 1px solid #e5e7eb; text-align: right;">
                                            <span style="color: #1f2937; font-size: 14px; font-weight: 600;">${paymentDate}</span>
                                        </td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 10px 0; border-bottom: 1px solid #e5e7eb;">
                                            <span style="color: #6b7280; font-size: 14px; font-weight: 600;">Order Status:</span>
                                        </td>
                                        <td style="padding: 10px 0; border-bottom: 1px solid #e5e7eb; text-align: right;">
                                            <span style="background-color: #10b981; color: #ffffff; padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: 700;">CONFIRMED</span>
                                        </td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 10px 0;">
                                            <span style="color: #6b7280; font-size: 14px; font-weight: 600;">Amount Paid:</span>
                                        </td>
                                        <td style="padding: 10px 0; text-align: right;">
                                            <span style="color: #10b981; font-size: 20px; font-weight: 700;">$${orderTotal}</span>
                                        </td>
                                    </tr>
                                </table>
                            </div>

                            <!-- What Happens Next -->
                            <div style="margin-bottom: 30px;">
                                <h3 style="color: #1f2937; margin: 0 0 20px 0; font-size: 16px; font-weight: 700;">📋 What Happens Next</h3>
                                
                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                    <tr>
                                        <td style="width: 40px; vertical-align: top;">
                                            <div style="background-color: #10b981; color: #ffffff; width: 32px; height: 32px; border-radius: 50%; font-weight: 700; font-size: 16px; text-align: center; line-height: 32px;">1</div>
                                        </td>
                                        <td style="vertical-align: top; padding-bottom: 15px;">
                                            <p style="color: #1f2937; margin: 0 0 5px 0; font-size: 14px; font-weight: 600;">Order Processing</p>
                                            <p style="color: #6b7280; margin: 0; font-size: 13px; line-height: 1.5;">Your order is now being prepared for shipment</p>
                                        </td>
                                    </tr>
                                    <tr>
                                        <td style="width: 40px; vertical-align: top;">
                                            <div style="background-color: #10b981; color: #ffffff; width: 32px; height: 32px; border-radius: 50%; font-weight: 700; font-size: 16px; text-align: center; line-height: 32px;">2</div>
                                        </td>
                                        <td style="vertical-align: top; padding-bottom: 15px;">
                                            <p style="color: #1f2937; margin: 0 0 5px 0; font-size: 14px; font-weight: 600;">Tracking Information</p>
                                            <p style="color: #6b7280; margin: 0; font-size: 13px; line-height: 1.5;">You'll receive tracking details within 24-48 hours</p>
                                        </td>
                                    </tr>
                                    <tr>
                                        <td style="width: 40px; vertical-align: top;">
                                            <div style="background-color: #10b981; color: #ffffff; width: 32px; height: 32px; border-radius: 50%; font-weight: 700; font-size: 16px; text-align: center; line-height: 32px;">3</div>
                                        </td>
                                        <td style="vertical-align: top;">
                                            <p style="color: #1f2937; margin: 0 0 5px 0; font-size: 14px; font-weight: 600;">Delivery</p>
                                            <p style="color: #6b7280; margin: 0; font-size: 13px; line-height: 1.5;">Expected delivery: 3-5 business days</p>
                                        </td>
                                    </tr>
                                </table>
                            </div>

                            <!-- Shipping Info Box -->
                            <div style="background-color: #f0f9ff; border: 1px solid #3b82f6; border-radius: 8px; padding: 20px; margin-bottom: 30px;">
                                <h3 style="color: #1e40af; margin: 0 0 15px 0; font-size: 16px; font-weight: 700;">🚚 Shipping Details</h3>
                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                    <tr>
                                        <td style="padding: 5px 0;">
                                            <p style="color: #1f2937; margin: 0; font-size: 14px; line-height: 1.6;"><strong>Shipping To:</strong></p>
                                            <p style="color: #4b5563; margin: 5px 0 0 0; font-size: 13px; line-height: 1.6;">
                                                ${shippingAddress}
                                            </p>
                                        </td>
                                    </tr>
                                </table>
                            </div>

                            <!-- Track Order Button -->
                            <div style="text-align: center; margin-bottom: 30px;">
                                <a href="${orderTrackingUrl}" style="display: inline-block; background-color: #3b82f6; color: #ffffff; padding: 16px 36px; text-decoration: none; border-radius: 8px; font-size: 15px; font-weight: 700; letter-spacing: 0.3px;">Track Your Order</a>
                            </div>

                            <!-- Support -->
                            <div style="background-color: #f9fafb; border-left: 3px solid #6b7280; padding: 15px; border-radius: 4px;">
                                <p style="color: #4b5563; margin: 0; font-size: 13px; line-height: 1.6;">
                                    <strong style="color: #1f2937;">Questions?</strong> Contact our support team at <a href="mailto:${supportEmail}" style="color: #3b82f6; text-decoration: none; font-weight: 600;">${supportEmail}</a> or call ${supportPhone}.
                                </p>
                            </div>
                        </td>
                    </tr>

                    <!-- Footer -->
                    <tr>
                        <td style="background-color: #f9fafb; padding: 30px; text-align: center; border-top: 1px solid #e5e7eb;">
                            <p style="color: #6b7280; margin: 0 0 10px 0; font-size: 13px;">Questions? Contact us at <a href="mailto:${supportEmail}" style="color: #3b82f6; text-decoration: none; font-weight: 600;">${supportEmail}</a></p>
                            <p style="color: #9ca3af; margin: 0; font-size: 12px;">© ${currentYear} ${storeName}. All rights reserved.</p>
                            <p style="color: #9ca3af; margin: 10px 0 0 0; font-size: 11px;">This is an automated message. Please do not reply to this email.</p>
                        </td>
                    </tr>

                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;
  }

  private async getCompletedNotificationTemplate(order: Order): Promise<string> {
    // Get merchant information from database using order domain
    let supportEmail = this.configService.get('SUPPORT_EMAIL') || this.configService.get('EMAIL_FROM') || 'support@dexxpay.com';
    let supportPhone = this.configService.get('SUPPORT_PHONE') || '1-800-XXX-XXXX';
    
    if (order.domain) {
      try {
        const merchant = await this.merchantsService.findByDomain(order.domain);
        if (merchant) {
          supportEmail = merchant.contact_email;
          if (merchant.contact_phone) {
            supportPhone = merchant.contact_phone;
          }
        }
      } catch (error) {
        console.error('Error fetching merchant information:', error);
        // Fall back to defaults if merchant lookup fails
      }
    }
    
    const storeName = this.configService.get('STORE_NAME') || 'DexPay';
    const orderTotal = (Number(order.total) / 100).toFixed(2);
    const orderNumber = order.woo_order_id || order.id.toString();
    const customerName = order.customer_name || 'N/A';
    const paymentDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const currentYear = new Date().getFullYear();
    
    // Build shipping address
    const shippingAddressParts = [];
    if (order.address) shippingAddressParts.push(order.address);
    if (order.city) shippingAddressParts.push(order.city);
    if (order.province_territory) shippingAddressParts.push(order.province_territory);
    if (order.country) shippingAddressParts.push(order.country);
    const shippingAddress = shippingAddressParts.length > 0 ? shippingAddressParts.join(', ') : 'N/A';
    
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Payment Confirmed - Merchant Notification</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f3f4f6;">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #f3f4f6; padding: 40px 0;">
        <tr>
            <td align="center">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05); overflow: hidden;">
                    
                    <!-- Header with Green Background -->
                    <tr>
                        <td style="background-color: #10b981; padding: 40px 30px; text-align: center;">
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin: 0 auto 20px auto;">
                                <tr>
                                    <td style="background-color: rgba(255, 255, 255, 0.2); width: 80px; height: 80px; border-radius: 50%; text-align: center; vertical-align: middle; padding: 15px;">
                                        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="50" height="50" style="margin: 0 auto;">
                                            <tr>
                                                <td style="background-color: #ffffff; width: 50px; height: 50px; border-radius: 50%; text-align: center; vertical-align: middle;">
                                                    <span style="color: #10b981; font-size: 32px; font-weight: 700; line-height: 50px;">✓</span>
                                                </td>
                                            </tr>
                                        </table>
                                    </td>
                                </tr>
                            </table>
                            <h1 style="color: #ffffff; margin: 0 0 10px 0; font-size: 28px; font-weight: 700; letter-spacing: -0.5px;">Payment Confirmed!</h1>
                            <p style="color: #ffffff; margin: 0; font-size: 16px; opacity: 0.9;">Payment received - Order ready for fulfillment</p>
                        </td>
                    </tr>

                    <!-- Content -->
                    <tr>
                        <td style="padding: 40px 30px;">
                            
                            <!-- Greeting -->
                            <p style="color: #1f2937; margin: 0 0 20px 0; font-size: 16px; line-height: 1.6;">Hello,</p>
                            
                            <p style="color: #4b5563; margin: 0 0 30px 0; font-size: 15px; line-height: 1.6;">Payment has been successfully received for the following order. Please proceed with order fulfillment.</p>

                            <!-- Success Box -->
                            <div style="background-color: #ecfdf5; border: 2px solid #10b981; border-radius: 12px; padding: 25px; margin-bottom: 30px; text-align: center;">
                                <h2 style="color: #15803d; margin: 0 0 10px 0; font-size: 22px; font-weight: 700;">💰 Payment Received</h2>
                                <p style="color: #166534; margin: 0; font-size: 18px; font-weight: 600;">Amount: <span style="font-size: 24px; font-weight: 700;">$${orderTotal}</span></p>
                            </div>

                            <!-- Order Details -->
                            <div style="background-color: #f9fafb; border-left: 4px solid #10b981; border-radius: 8px; padding: 25px; margin-bottom: 30px;">
                                <h2 style="color: #1f2937; margin: 0 0 20px 0; font-size: 18px; font-weight: 700;">📦 Order Summary</h2>
                                
                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                    <tr>
                                        <td style="padding: 10px 0; border-bottom: 1px solid #e5e7eb;">
                                            <span style="color: #6b7280; font-size: 14px; font-weight: 600;">Order Number:</span>
                                        </td>
                                        <td style="padding: 10px 0; border-bottom: 1px solid #e5e7eb; text-align: right;">
                                            <span style="color: #1f2937; font-size: 14px; font-weight: 700; font-family: 'Courier New', monospace;">${orderNumber}</span>
                                        </td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 10px 0; border-bottom: 1px solid #e5e7eb;">
                                            <span style="color: #6b7280; font-size: 14px; font-weight: 600;">Payment Date:</span>
                                        </td>
                                        <td style="padding: 10px 0; border-bottom: 1px solid #e5e7eb; text-align: right;">
                                            <span style="color: #1f2937; font-size: 14px; font-weight: 600;">${paymentDate}</span>
                                        </td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 10px 0; border-bottom: 1px solid #e5e7eb;">
                                            <span style="color: #6b7280; font-size: 14px; font-weight: 600;">Order Status:</span>
                                        </td>
                                        <td style="padding: 10px 0; border-bottom: 1px solid #e5e7eb; text-align: right;">
                                            <span style="background-color: #10b981; color: #ffffff; padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: 700;">PROCESSING</span>
                                        </td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 10px 0;">
                                            <span style="color: #6b7280; font-size: 14px; font-weight: 600;">Amount Received:</span>
                                        </td>
                                        <td style="padding: 10px 0; text-align: right;">
                                            <span style="color: #10b981; font-size: 20px; font-weight: 700;">$${orderTotal}</span>
                                        </td>
                                    </tr>
                                </table>
                            </div>

                            <!-- Customer Information -->
                            <div style="background-color: #f9fafb; border-left: 4px solid #10b981; border-radius: 8px; padding: 25px; margin-bottom: 30px;">
                                <h2 style="color: #1f2937; margin: 0 0 20px 0; font-size: 18px; font-weight: 700;">👤 Customer Information</h2>
                                
                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                    <tr>
                                        <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
                                            <span style="color: #6b7280; font-size: 13px; font-weight: 600;">Customer Name:</span>
                                        </td>
                                        <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb; text-align: right;">
                                            <span style="color: #1f2937; font-size: 14px; font-weight: 600;">${customerName}</span>
                                        </td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
                                            <span style="color: #6b7280; font-size: 13px; font-weight: 600;">Customer Email:</span>
                                        </td>
                                        <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb; text-align: right;">
                                            <span style="color: #1f2937; font-size: 14px; font-weight: 700; font-family: 'Courier New', monospace;">${order.customer_email}</span>
                                        </td>
                                    </tr>
                                    ${order.phone_number ? `
                                    <tr>
                                        <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
                                            <span style="color: #6b7280; font-size: 13px; font-weight: 600;">Phone Number:</span>
                                        </td>
                                        <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb; text-align: right;">
                                            <span style="color: #1f2937; font-size: 14px; font-weight: 600;">${order.phone_number}</span>
                                        </td>
                                    </tr>
                                    ` : ''}
                                    <tr>
                                        <td style="padding: 12px 0;">
                                            <span style="color: #6b7280; font-size: 13px; font-weight: 600;">Shipping Address:</span>
                                        </td>
                                        <td style="padding: 12px 0; text-align: right;">
                                            <span style="color: #1f2937; font-size: 14px; font-weight: 600;">${shippingAddress}</span>
                                        </td>
                                    </tr>
                                </table>
                            </div>

                            <!-- Action Required -->
                            <div style="background-color: #fef2f2; border: 1px solid #ef4444; border-radius: 8px; padding: 20px; margin-bottom: 30px;">
                                <h3 style="color: #991b1b; margin: 0 0 15px 0; font-size: 16px; font-weight: 700;">⚠️ Action Required</h3>
                                <ul style="color: #991b1b; margin: 0; padding-left: 20px; font-size: 13px; line-height: 1.8;">
                                    <li style="margin-bottom: 8px;">Prepare the order for shipment</li>
                                    <li style="margin-bottom: 8px;">Update order status to "processing" or "completed" when ready</li>
                                    <li style="margin-bottom: 0;">Send tracking information to the customer once shipped</li>
                                </ul>
                            </div>

                            <!-- Support -->
                            <div style="background-color: #f9fafb; border-left: 3px solid #6b7280; padding: 15px; border-radius: 4px;">
                                <p style="color: #4b5563; margin: 0; font-size: 13px; line-height: 1.6;">
                                    <strong style="color: #1f2937;">Need Help?</strong> If you have questions about this order, contact support at <a href="mailto:${supportEmail}" style="color: #10b981; text-decoration: none; font-weight: 600;">${supportEmail}</a> or call ${supportPhone}.
                                </p>
                            </div>
                        </td>
                    </tr>

                    <!-- Footer -->
                    <tr>
                        <td style="background-color: #f9fafb; padding: 30px; text-align: center; border-top: 1px solid #e5e7eb;">
                            <p style="color: #6b7280; margin: 0 0 10px 0; font-size: 13px;">Questions? Contact us at <a href="mailto:${supportEmail}" style="color: #10b981; text-decoration: none; font-weight: 600;">${supportEmail}</a></p>
                            <p style="color: #9ca3af; margin: 0; font-size: 12px;">© ${currentYear} ${storeName}. All rights reserved.</p>
                            <p style="color: #9ca3af; margin: 10px 0 0 0; font-size: 11px;">This is an automated message. Please do not reply to this email.</p>
                        </td>
                    </tr>

                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;
  }
}

