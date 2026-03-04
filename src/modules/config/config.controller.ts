import { Controller, Get, Query, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { LicensesService } from '../licenses/licenses.service';

/**
 * GET /api/config/geoapify?license_key=XXXXX&domain=merchant.com
 *
 * Returns the shared Geoapify API key to authenticated merchant plugins.
 * Auth: same license_key + domain validation used everywhere else.
 *
 * Response (200): { api_key: "abc123...", enabled: true }
 * Response (401): { error: "Invalid license key" }
 * Response (403): { api_key: null, enabled: false }
 */
@Controller('api/config')
  export class ConfigController {
    private readonly GEOAPIFY_API_KEY = process.env.GEOAPIFY_API_KEY || '';

  constructor(
        @Inject(LicensesService)
        private readonly licensesService: LicensesService,
      ) {}

  @Get('geoapify')
    async getGeoapifyConfig(
          @Query('license_key') licenseKey: string,
          @Query('domain') domain: string,
        ) {
          // Validate inputs
      if (!licenseKey || !domain) {
              throw new HttpException(
                { error: 'license_key and domain are required' },
                        HttpStatus.BAD_REQUEST,
                      );
      }

      // Validate license using existing service (same auth as everything else)
      try {
              const validation = await this.licensesService.validateLicense({
                        license_key: licenseKey,
                        domain: domain,
              });

            if (!validation.valid) {
                      throw new HttpException(
                        { error: validation.message || 'Invalid license key' },
                                  HttpStatus.UNAUTHORIZED,
                                );
            }
      } catch (error) {
              if (error instanceof HttpException) {
                        throw error;
              }
              console.error('[ConfigController] License validation error:', error);
              throw new HttpException(
                { error: 'License validation failed' },
                        HttpStatus.INTERNAL_SERVER_ERROR,
                      );
      }

      // Check if Geoapify is configured
      if (!this.GEOAPIFY_API_KEY) {
              return {
                        api_key: null,
                        enabled: false,
                        message: 'Address autocomplete is not configured on the server',
              };
      }

      // Return the key
      return {
              api_key: this.GEOAPIFY_API_KEY,
              enabled: true,
      };
    }
}
