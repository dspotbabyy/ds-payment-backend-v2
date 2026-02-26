import { Controller, Get, Query } from '@nestjs/common';
import axios from 'axios';

@Controller('address')
  export class AddressController {

  @Get('autocomplete')
  async autocomplete(@Query('text') text: string) {

    if (!text) {
      return { success: false, results: [] };
    }

    const apiKey = process.env.GEOAPIFY_KEY;

    const url =
      `https://api.geoapify.com/v1/geocode/autocomplete` +
      `?text=${encodeURIComponent(text)}` +
      `&filter=countrycode:ca` +
      `&limit=5` +
      `&apiKey=${apiKey}`;

    const response = await axios.get(url);

    return {
      success: true,
      results: response.data.features
    };
  }

}
