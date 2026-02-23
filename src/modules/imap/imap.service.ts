import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Order } from '../../database/entities/order.entity';
import { EmailService } from '../email/email.service';
import axios from 'axios';

/** Parsed Interac e-Transfer payment notification (from notify@payments.interac.ca) */
export interface PaymentEvent {
  status: string;
  amount_cents: number;
  text: string;
  orderReference: string | null;
  senderEmail: string | null; // customer who sent the e-Transfer (from email body)
  email_uid: number;
}

/** Result of order matching with explicit confidence score */
export interface MatchResult {
  order: Order;
  confidence: number;
}

/** Only auto-confirm when confidence >= this (reference+amount=100%, amount+email=90%, amount only=70%) */
const DEFAULT_CONFIDENCE_THRESHOLD = 90;

@Injectable()
export class ImapService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ImapService.name);
  private client: ImapFlow | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isReconnecting = false;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 10;
  private readonly reconnectDelay = 5000; // 5 seconds initial delay

  constructor(
    private configService: ConfigService,
    @InjectRepository(Order)
    private orderRepository: Repository<Order>,
    private emailService: EmailService,
  ) {}

  async onModuleInit() {
    const imapHost = this.configService.get('IMAP_HOST');
    const imapUser = this.configService.get('IMAP_USER');
    const imapPass = this.configService.get('IMAP_PASS');

    if (!imapHost || !imapUser || !imapPass) {
      this.logger.warn('⚠️ IMAP credentials not configured, skipping IMAP initialization');
      return;
    }

    try {
      await this.startImap();
      this.logger.log('✅ IMAP listening...');
    } catch (error: any) {
      this.logger.error('❌ Error starting IMAP:', error?.message || error);
      // Don't crash the app - reconnection logic will handle it
      this.logger.log('🔄 Will attempt to reconnect automatically...');
    }
  }

  async onModuleDestroy() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.client) {
      try {
        // Remove all listeners to prevent errors during shutdown
        this.client.removeAllListeners();
        await this.client.logout();
        this.logger.log('🛑 IMAP connection closed');
      } catch (error) {
        this.logger.error('❌ Error closing IMAP connection:', error);
      }
    }
  }

  private async startImap() {
    const imapHost = this.configService.get('IMAP_HOST');
    const imapPort = this.configService.get('IMAP_PORT');
    const imapUser = this.configService.get('IMAP_USER');
    const imapPass = this.configService.get('IMAP_PASS');
    const imapSecure = this.configService.get('IMAP_SECURE') === 'true';

    this.client = new ImapFlow({
      host: imapHost,
      port: imapPort ? parseInt(imapPort) : 993,
      secure: imapSecure !== false,
      auth: {
        user: imapUser,
        pass: imapPass,
      },
      logger: false,
    });

    // Set up error handler BEFORE connecting
    this.client.on('error', (err: any) => {
      // Prevent unhandled error events from crashing the app
      this.logger.error(`❌ IMAP connection error: ${err.message}`, err.code);
      if (err.code === 'ETIMEOUT' || err.code === 'ECONNRESET' || err.code === 'EPIPE') {
        this.logger.warn('🔄 Connection lost, will attempt to reconnect...');
        this.handleReconnect();
      } else {
        // For other errors, also attempt reconnection
        this.logger.warn('🔄 Unexpected error, will attempt to reconnect...');
        this.handleReconnect();
      }
    });

    // Handle connection close
    this.client.on('close', () => {
      this.logger.warn('🔌 IMAP connection closed');
      if (!this.isReconnecting) {
        this.handleReconnect();
      }
    });

    try {
      await this.client.connect();
      await this.client.mailboxOpen('INBOX');
      
      // Reset reconnect attempts on successful connection
      this.reconnectAttempts = 0;
      this.isReconnecting = false;
    } catch (error: any) {
      this.logger.error('❌ Error during IMAP connection:', error.message);
      // Clean up failed connection
      if (this.client) {
        try {
          this.client.removeAllListeners();
        } catch (e) {
          // Ignore cleanup errors
        }
        this.client = null;
      }
      // Attempt reconnection
      this.handleReconnect();
      throw error; // Re-throw to let caller know connection failed
    }

    // Process existing unread emails immediately
    this.logger.log('🔍 Processing existing unread emails...');
    try {
      for await (const message of this.client.fetch('*', {
        source: true,
        envelope: true,
        uid: true,
        flags: true,
      })) {
        this.logger.log(
          `📧 Found message UID: ${message.uid}, Flags: ${Array.from(message.flags)}`,
        );
        if (message.flags.has('\\Seen')) {
          this.logger.log(`⏭️ Skipping already seen email: ${message.uid}`);
          continue;
        }

        // Check if this is an Interac notification email
        const envelope = message.envelope;
        const fromEmail = envelope?.from?.[0]?.address;
        this.logger.log(`📧 Email from: ${fromEmail}`);

        // Check for Interac notification emails
        const interacPatterns = [
          'notify@payments.interac.ca',
          'noreply@interac.ca',
          'notifications@interac.ca',
          'interac.ca',
        ];

        const isInteracEmail = interacPatterns.some(
          (pattern) =>
            fromEmail && fromEmail.toLowerCase().includes(pattern.toLowerCase()),
        );

        if (!fromEmail || !isInteracEmail) {
          this.logger.log(`⏭️ Skipping non-Interac email from: ${fromEmail}`);
          continue;
        }

        this.logger.log(`✅ Found Interac email from: ${fromEmail}`);
        this.logger.log(`📧 Processing Interac notification email: ${message.uid}`);

        try {
          const parsed = await simpleParser(message.source);
          const combinedText = (parsed.text || '') + ' ' + (parsed.html || '');

          this.logger.log(
            `📝 Email content preview: ${combinedText.substring(0, 200)}...`,
          );

          const parsedEv = this.parseInteracEmail(combinedText);
          if (parsedEv.amount_cents) this.logger.log(`💰 Amount detected: ${parsedEv.amount_cents} cents`);
          if (parsedEv.orderReference) this.logger.log(`📋 Order reference: ${parsedEv.orderReference}`);

          const ev: PaymentEvent = { ...parsedEv, email_uid: message.uid };
          this.logger.log('🔔 Processing email event:', {
            status: ev.status,
            amount_cents: ev.amount_cents,
            orderReference: ev.orderReference,
            senderEmail: ev.senderEmail ?? '(none)',
            email_uid: ev.email_uid,
          });

          const processResult = await this.processEvent(ev);

          // Mark email as read ONLY after successfully processing and updating database
          if (processResult && this.client) {
            await this.client.messageFlagsAdd(message.uid, ['\\Seen']);
            this.logger.log(`✅ Email ${message.uid} marked as read after successful processing`);
          } else if (!processResult) {
            this.logger.log(`⚠️ Email ${message.uid} not marked as read (no order match or no update needed)`);
          }
        } catch (error: unknown) {
          const err = error as { message?: string };
          this.logger.error('❌ Error processing email:', error);
          this.logger.error(`Email UID: ${message.uid}`);
          this.logger.error(`Error details: ${err?.message ?? String(error)}`);
          // Don't mark as read if there was an error
        }
      }
    } catch (error) {
      this.logger.error('❌ Error processing existing emails:', error);
    }

    // Error handler is already set up before connection

    // Listen for new emails
    this.client.on('exists', async () => {
      this.logger.log('🔔 EXISTS event fired - checking for unread emails...');

      for await (const message of this.client.fetch('*', {
        source: true,
        envelope: true,
        uid: true,
        flags: true,
      })) {
        const envelope = message.envelope;
        const fromEmail = envelope?.from?.[0]?.address;
        const isSeen = message.flags.has('\\Seen');

        this.logger.log(
          `📧 Found message UID: ${message.uid}, From: ${fromEmail}, Seen: ${isSeen}`,
        );

        // Accept emails from both interac.ca and payments.interac.ca
        if (
          !fromEmail ||
          (!fromEmail.includes('interac.ca') &&
            !fromEmail.includes('payments.interac.ca'))
        ) {
          this.logger.log(`⏭️ Skipping non-Interac email from: ${fromEmail}`);
          continue;
        }

        // Note: The old code had this commented out, so we process ALL emails
        // if (message.flags.has('\\Seen')) {
        //   this.logger.log(`⏭️ Skipping already seen email: ${message.uid}`);
        //   continue;
        // }

        this.logger.log(`✅ Processing Interac email from: ${fromEmail}`);

        try {
          this.logger.log(`📧 Processing email: ${message.uid}`);

          const parsed = await simpleParser(message.source);
          const combinedText = (parsed.text || '') + ' ' + (parsed.html || '');

          this.logger.log(
            `📝 Email content preview: ${combinedText.substring(0, 200)}...`,
          );

          const parsedEv = this.parseInteracEmail(combinedText);
          if (parsedEv.amount_cents) this.logger.log(`💰 Amount detected: ${parsedEv.amount_cents} cents`);
          if (parsedEv.orderReference) this.logger.log(`📋 Order reference: ${parsedEv.orderReference}`);

          const ev: PaymentEvent = { ...parsedEv, email_uid: message.uid };
          this.logger.log('🔔 Processing email event:', {
            status: ev.status,
            amount_cents: ev.amount_cents,
            orderReference: ev.orderReference,
            senderEmail: ev.senderEmail ?? '(none)',
            email_uid: ev.email_uid,
          });

          const processResult = await this.processEvent(ev);

          // Mark email as read ONLY after successfully processing and updating database
          if (processResult && this.client) {
            await this.client.messageFlagsAdd(message.uid, ['\\Seen']);
            this.logger.log(`✅ Email ${message.uid} marked as read after successful processing`);
          } else if (!processResult) {
            this.logger.log(`⚠️ Email ${message.uid} not marked as read (no order match or no update needed)`);
          }
        } catch (error: unknown) {
          const err = error as { message?: string };
          this.logger.error('❌ Error processing email:', error);
          this.logger.error(`Email UID: ${message.uid}`);
          this.logger.error(`Error details: ${err?.message ?? String(error)}`);
          // Don't mark as read if there was an error
        }
      }
    });

    return this.client;
  }

  private async handleReconnect() {
    if (this.isReconnecting) {
      this.logger.log('⏳ Reconnection already in progress...');
      return;
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.logger.error(
        `❌ Max reconnection attempts (${this.maxReconnectAttempts}) reached. Stopping reconnection attempts.`,
      );
      return;
    }

    this.isReconnecting = true;
    this.reconnectAttempts++;

    // Clean up old connection
    if (this.client) {
      try {
        this.client.removeAllListeners();
        await this.client.logout().catch(() => {
          // Ignore logout errors during reconnection
        });
      } catch (error) {
        // Ignore cleanup errors
      }
      this.client = null;
    }

    // Calculate exponential backoff delay
    const delay = Math.min(
      this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
      60000, // Max 60 seconds
    );

    this.logger.log(
      `🔄 Attempting to reconnect in ${delay / 1000} seconds (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`,
    );

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.startImap();
        this.logger.log('✅ IMAP reconnected successfully');
        this.isReconnecting = false;
        this.reconnectAttempts = 0;
      } catch (error) {
        this.logger.error('❌ Reconnection failed:', error);
        this.isReconnecting = false;
        // Try again
        this.handleReconnect();
      }
    }, delay);
  }

  /**
   * Parse Interac e-Transfer notification body: amount, status, order reference, and transfer sender email.
   */
  private parseInteracEmail(combinedText: string): Omit<PaymentEvent, 'email_uid'> {
    let status = 'requested';
    if (/deposited|accepted|approved|completed|received/i.test(combinedText)) {
      status = 'approved';
    } else if (/cancelled|declined|rejected|failed/i.test(combinedText)) {
      status = 'cancelled';
    }

    const amountPatterns = [
      /\$([0-9]+(?:\.[0-9]{2})?)/,
      /amount[:\s]*\$([0-9]+(?:\.[0-9]{2})?)/i,
      /total[:\s]*\$([0-9]+(?:\.[0-9]{2})?)/i,
      /([0-9]+(?:\.[0-9]{2})?)\s*CAD/i,
      /([0-9]+(?:\.[0-9]{2})?)\s*dollars/i,
    ];
    let amount_cents = 0;
    for (const pattern of amountPatterns) {
      const match = combinedText.match(pattern);
      if (match) {
        amount_cents = Math.round(parseFloat(match[1]) * 100);
        break;
      }
    }

    const orderRefPatterns = [
      /order[:\s]*#?(\d+)/i,
      /reference[:\s]*([A-Z0-9-]+)/i,
      /ref[:\s]*([A-Z0-9-]+)/i,
      /#(\d+)/,
      /ORD-(\d+)/,
    ];
    let orderReference: string | null = null;
    for (const pattern of orderRefPatterns) {
      const match = combinedText.match(pattern);
      if (match) {
        orderReference = match[1];
        break;
      }
    }

    const senderEmail = this.extractSenderEmailFromBody(combinedText);

    return { status, amount_cents, text: combinedText, orderReference, senderEmail };
  }

  /**
   * Extract the e-Transfer sender (customer) email from Interac notification body.
   */
  private extractSenderEmailFromBody(combinedText: string): string | null {
    const senderPatterns = [
      /(?:from|sent by|sender|received from|sent from|transfer from)[:\s]*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i,
      /(?:e-Transfer\s+)?from[:\s]*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i,
    ];
    for (const pattern of senderPatterns) {
      const match = combinedText.match(pattern);
      if (match && match[1]) {
        const email = match[1].trim().toLowerCase();
        if (!email.includes('interac.ca') && !email.includes('payments.interac')) {
          this.logger.log(`📤 Transfer sender email detected: ${email}`);
          return email;
        }
      }
    }
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const emails = combinedText.match(emailRegex) || [];
    for (const email of emails) {
      const lower = email.toLowerCase();
      if (!lower.includes('interac.ca') && !lower.includes('payments.interac') && !lower.includes('noreply')) {
        this.logger.log(`📤 Transfer sender email (fallback): ${lower}`);
        return lower;
      }
    }
    return null;
  }

  private getConfidenceThreshold(): number {
    const env = this.configService.get('IMAP_CONFIDENCE_THRESHOLD');
    if (env != null && env !== '') {
      const n = parseInt(env, 10);
      if (!Number.isNaN(n) && n >= 0 && n <= 100) return n;
    }
    return DEFAULT_CONFIDENCE_THRESHOLD;
  }

  private async processEvent(ev: PaymentEvent): Promise<boolean> {
    const threshold = this.getConfidenceThreshold();
    this.logger.log('🔄 Processing payment event:', {
      status: ev.status,
      amount_cents: ev.amount_cents,
      orderReference: ev.orderReference,
      senderEmail: ev.senderEmail ?? '(none)',
      email_uid: ev.email_uid,
      confidenceThreshold: threshold,
    });

    if (!ev.amount_cents) {
      this.logger.log('⚠️ No amount detected, skipping matching');
      return false;
    }

    const matchResult = await this.findMatchingOrder(ev);

    if (!matchResult) {
      this.logger.log(`⚠️ No matching order found for amount: ${ev.amount_cents}`);
      return false;
    }

    const { order, confidence } = matchResult;
    this.logger.log(`✅ Found matching order: ${order.id} (${confidence}% confidence)`);

    if (confidence < threshold) {
      this.logger.log(
        `⏭️ Confidence ${confidence}% below threshold ${threshold}% - skipping auto-confirm (manual review recommended)`,
      );
      return false;
    }

    const oldStatus = order.status;

    let newStatus = 'pending';
    if (ev.status === 'approved' || ev.status === 'deposited') {
      newStatus = 'completed';
    }

    if (newStatus === oldStatus) {
      this.logger.log(
        `⚠️ Order ${order.id} status is already ${newStatus}, skipping update`,
      );
      return false;
    }

    order.status = newStatus;
    const updatedOrder = await this.orderRepository.save(order);

    this.logger.log(
      `✅ Order ${order.id} updated to status: ${newStatus} (was ${oldStatus}) - confidence ${confidence}%`,
    );

    if (updatedOrder && newStatus !== oldStatus) {
      const merchantEmail = updatedOrder.merchant_email;
      if (merchantEmail) {
        this.emailService
          .sendOrderStatusEmails(updatedOrder, oldStatus, merchantEmail)
          .catch((err) =>
            this.logger.error(
              '❌ Error sending email notifications after status change:',
              err,
            ),
          );
      }
    }

    if (order.woo_order_id) {
      await this.updateWooCommerceOrder(order.woo_order_id, newStatus, confidence);
    }

    return true;
  }

  /**
   * Find order matching the payment event and return it with explicit confidence score.
   * Confidence: reference+amount = 100%, amount+sender email = 90%, amount only = 70%, fuzzy = 50–100%.
   * Note: order.total is stored in dollars; ev.amount_cents is in cents.
   */
  private async findMatchingOrder(ev: PaymentEvent): Promise<MatchResult | null> {
    const amountDollars = ev.amount_cents / 100;

    // 100%: exact amount + order reference (e.g. woo_order_id)
    if (ev.orderReference) {
      const exactMatch = await this.orderRepository.findOne({
        where: {
          total: amountDollars,
          woo_order_id: ev.orderReference,
          status: 'pending',
        },
        order: { date: 'DESC' },
      });

      if (exactMatch) {
        this.logger.log(`✅ Found exact match (ref+amount): Order ${exactMatch.id} → 100% confidence`);
        return { order: exactMatch, confidence: 100 };
      }
    }

    // 90%: amount + sender email matches order.customer_email
    if (ev.senderEmail) {
      const amountAndSenderMatch = await this.orderRepository
        .createQueryBuilder('order')
        .where('order.total = :amount', { amount: amountDollars })
        .andWhere('order.status = :status', { status: 'pending' })
        .andWhere('LOWER(TRIM(order.customer_email)) = LOWER(TRIM(:senderEmail))', {
          senderEmail: ev.senderEmail,
        })
        .orderBy('order.date', 'DESC')
        .getOne();

      if (amountAndSenderMatch) {
        this.logger.log(
          `✅ Found amount+sender match: Order ${amountAndSenderMatch.id} → 90% confidence`,
        );
        return { order: amountAndSenderMatch, confidence: 90 };
      }
    }

    // 70%: amount only (most recent pending order with this amount)
    const amountOnlyOrders = await this.orderRepository.find({
      where: { total: amountDollars, status: 'pending' },
      order: { date: 'DESC' },
      take: 1,
    });
    if (amountOnlyOrders.length > 0) {
      this.logger.log(`✅ Found amount-only match: Order ${amountOnlyOrders[0].id} → 70% confidence`);
      return { order: amountOnlyOrders[0], confidence: 70 };
    }

    // Fuzzy: recent orders, score 50–100% (amount 70% + reference 30%). Compare in cents.
    const recentOrders = await this.orderRepository.find({
      where: { status: 'pending' },
      order: { date: 'DESC' },
      take: 15,
    });

    let bestMatch: Order | null = null;
    let bestScore = 0;

    for (const candidateOrder of recentOrders) {
      let score = 0;
      const orderAmountCents = Math.round(Number(candidateOrder.total) * 100);
      const amountDiff = Math.abs(orderAmountCents - ev.amount_cents);

      if (amountDiff === 0) {
        score += 70;
      } else if (amountDiff <= 1) {
        score += 50;
      } else if (amountDiff <= 5) {
        score += 30;
      }

      if (ev.orderReference && candidateOrder.woo_order_id) {
        const refStr = candidateOrder.woo_order_id.toString();
        if (ev.orderReference === refStr) {
          score += 30;
        } else if (refStr.includes(ev.orderReference)) {
          score += 20;
        }
      }

      if (score > bestScore && score >= 50) {
        bestScore = score;
        bestMatch = candidateOrder;
      }
    }

    if (bestMatch) {
      this.logger.log(
        `✅ Found fuzzy match: Order ${bestMatch.id} (${bestScore}% confidence)`,
      );
      return { order: bestMatch, confidence: bestScore };
    }

    return null;
  }

  private async updateWooCommerceOrder(
    wooOrderId: string,
    newStatus: string,
    confidence: number,
  ) {
    const wooUrl = this.configService.get('WOOCOMMERCE_URL');
    const wooConsumerKey = this.configService.get('WOOCOMMERCE_CONSUMER_KEY');
    const wooConsumerSecret = this.configService.get(
      'WOOCOMMERCE_CONSUMER_SECRET',
    );

    if (!wooUrl || !wooConsumerKey || !wooConsumerSecret) {
      this.logger.log('⚠️ WooCommerce API credentials not configured');
      return;
    }

    const wooStatus = this.mapToWooCommerceStatus(newStatus);

    if (!wooStatus) {
      this.logger.log(`⚠️ No WooCommerce status mapping for: ${newStatus}`);
      return;
    }

    const updatePayload = {
      status: wooStatus,
      meta_data: [
        {
          key: '_etransfer_payment_confirmed',
          value: 'true',
        },
        {
          key: '_etransfer_confidence',
          value: confidence.toString(),
        },
        {
          key: '_etransfer_updated_at',
          value: new Date().toISOString(),
        },
      ],
    };

    const maxRetries = 3;
    let retryCount = 0;

    while (retryCount < maxRetries) {
      try {
        this.logger.log(
          `🔄 Updating WooCommerce order ${wooOrderId} to status: ${wooStatus} (attempt ${retryCount + 1})`,
        );

        const response = await axios.put(
          `${wooUrl}/wp-json/wc/v3/orders/${wooOrderId}`,
          updatePayload,
          {
            auth: {
              username: wooConsumerKey,
              password: wooConsumerSecret,
            },
            headers: {
              'Content-Type': 'application/json',
            },
            timeout: 10000,
          },
        );

        this.logger.log(
          `✅ WooCommerce order ${wooOrderId} updated successfully`,
        );
        return;
      } catch (error: any) {
        retryCount++;
        this.logger.error(
          `❌ WooCommerce API error (attempt ${retryCount}):`,
          error.message,
        );

        if (retryCount < maxRetries) {
          const delay = Math.pow(2, retryCount) * 1000; // Exponential backoff
          this.logger.log(`⏳ Retrying in ${delay}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
        } else {
          this.logger.error(
            `❌ Failed to update WooCommerce order after ${maxRetries} attempts`,
          );
        }
      }
    }
  }

  private mapToWooCommerceStatus(status: string): string | null {
    const statusMap = {
      completed: 'processing',
      approved: 'processing',
      deposited: 'processing',
      pending: 'pending',
      cancelled: 'cancelled',
      failed: 'failed',
    };

    return statusMap[status] || null;
  }
}
