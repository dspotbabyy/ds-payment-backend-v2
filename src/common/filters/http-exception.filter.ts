import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let errorType = 'INTERNAL_ERROR';
    let displayType: 'error' | 'warning' | 'info' = 'error';
    let licenseErrorReason: string | null = null;
    let licenseRegisteredDomain: string | null = null;
    let licenseProvidedDomain: string | null = null;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      
      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        const responseObj = exceptionResponse as any;
        message = responseObj.message || exception.message || 'An error occurred';
      } else {
        message = exception.message || 'An error occurred';
      }

      // Determine error type and display type based on status code and message
      if (status === HttpStatus.UNAUTHORIZED) {
        errorType = 'UNAUTHORIZED';
        displayType = 'error';
        
        // Check if it's a license-related error
        if (
          message.toLowerCase().includes('license') ||
          message.toLowerCase().includes('domain') ||
          message.toLowerCase().includes('expired') ||
          message.toLowerCase().includes('inactive')
        ) {
          errorType = 'LICENSE_ERROR';
          
          // Extract specific error reason
          // Check domain mismatch FIRST (before checking if key doesn't exist)
          if (message.includes('registered for') && message.includes('but you are using it on')) {
            licenseErrorReason = 'DOMAIN_MISMATCH';
            // Extract domains from the new message format: "registered for "X" but you are using it on "Y""
            const domainMatch = message.match(/registered for "([^"]+)" but you are using it on "([^"]+)"/);
            if (domainMatch) {
              licenseRegisteredDomain = domainMatch[1];
              licenseProvidedDomain = domainMatch[2];
              // Keep the detailed message from the service, it's already user-friendly
            } else {
              // Fallback: try old format
              const oldFormatMatch = message.match(/registered for "([^"]+)" but provided domain is "([^"]+)"/);
              if (oldFormatMatch) {
                licenseRegisteredDomain = oldFormatMatch[1];
                licenseProvidedDomain = oldFormatMatch[2];
                message = `Your license key is registered for "${licenseRegisteredDomain}" but you are using it on "${licenseProvidedDomain}". Please update your domain in the plugin settings (WooCommerce > Settings > Payments > DexPay E-Transfer) to match the registered domain.`;
              }
            }
          } else if (message.includes('does not match the provided domain') || message.includes('does not match')) {
            licenseErrorReason = 'DOMAIN_MISMATCH';
            // Extract domains from the message
            const domainMatch = message.match(/registered for "([^"]+)" but provided domain is "([^"]+)"/);
            if (domainMatch) {
              licenseRegisteredDomain = domainMatch[1];
              licenseProvidedDomain = domainMatch[2];
              message = `Your license key is registered for "${licenseRegisteredDomain}" but you are using it on "${licenseProvidedDomain}". Please update your domain in the plugin settings (WooCommerce > Settings > Payments > DexPay E-Transfer) to match the registered domain.`;
            } else {
              message = 'License key does not match your domain. Please verify that the license key is registered for the correct domain in the plugin settings.';
            }
          } else if (message.includes('License key') && message.includes('does not exist')) {
            licenseErrorReason = 'INVALID_KEY';
            message = 'Invalid license key detected. Please check your license key in the plugin settings (WooCommerce > Settings > Payments > DexPay E-Transfer). The license key must be valid and match your domain.';
          } else if (message.includes('expired')) {
            licenseErrorReason = 'EXPIRED';
            // Extract expiry date if available
            const expiryMatch = message.match(/expired on ([0-9-]+)/);
            message = 'Your license key has expired. Please renew your license to continue using the plugin.';
          } else if (message.includes('inactive')) {
            licenseErrorReason = 'INACTIVE';
            message = 'Your license key is inactive. Please activate your license in the plugin settings.';
          } else if (message.includes('License key is required')) {
            licenseErrorReason = 'MISSING_KEY';
            message = 'License key is required. Please enter your license key in the plugin settings (WooCommerce > Settings > Payments > DexPay E-Transfer).';
          } else if (message.includes('Domain is required')) {
            licenseErrorReason = 'MISSING_DOMAIN';
            message = 'Domain is required for license validation. Please provide your domain in the plugin settings.';
          }
        }
      } else if (status === HttpStatus.BAD_REQUEST) {
        errorType = 'VALIDATION_ERROR';
        displayType = 'warning';
      } else if (status === HttpStatus.NOT_FOUND) {
        errorType = 'NOT_FOUND';
        displayType = 'warning';
      } else if (status === HttpStatus.FORBIDDEN) {
        errorType = 'FORBIDDEN';
        displayType = 'error';
      } else if (status === HttpStatus.CONFLICT) {
        errorType = 'CONFLICT';
        displayType = 'warning';
      }
    } else if (exception instanceof Error) {
      message = exception.message || 'An error occurred';
    }

    // Format response with metadata for frontend notification display
    const errorResponse = {
      success: false,
      error: {
        type: errorType,
        statusCode: status,
        message: message,
        displayType: displayType, // 'error', 'warning', or 'info' - helps frontend choose notification style
        timestamp: new Date().toISOString(),
        path: request.url,
        method: request.method,
      },
      // For license errors, add helpful metadata with specific error reason
      ...(errorType === 'LICENSE_ERROR' && {
        licenseError: {
          reason: licenseErrorReason || 'UNKNOWN',
          showInPluginSettings: true,
          settingsPath: 'WooCommerce > Settings > Payments > DexPay E-Transfer',
          requiresAction: true,
          ...(licenseRegisteredDomain && {
            registeredDomain: licenseRegisteredDomain,
          }),
          ...(licenseProvidedDomain && {
            providedDomain: licenseProvidedDomain,
          }),
        },
      }),
    };

    response.status(status).json(errorResponse);
  }
}

