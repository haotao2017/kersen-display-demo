import { Body, Controller, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '../../shared/auth.guard';
import { OfficialApiService } from './official-api.service';

type OfficialApiBody = {
  apiName?: string;
  resource?: string;
  action?: string;
  method?: 'GET' | 'POST';
  payload?: Record<string, unknown>;
  query?: Record<string, unknown>;
};

@UseGuards(AuthGuard)
@Controller('api/official-api')
export class OfficialApiController {
  constructor(private readonly officialApi: OfficialApiService) {}

  @Post('call')
  async call(@Body() body: OfficialApiBody) {
    return this.officialApi.call(body);
  }

  @Post('auto-template-samples')
  async autoTemplateSamples(@Body() body: {
    apiName?: string;
    apId: string;
    eslCode: string;
    templateId: number;
    sign?: string;
    storeCode?: string;
    fieldName?: string;
    values?: string[];
    productCodePrefix?: string;
    productNamePrefix?: string;
    basePrice?: number;
    timeoutMs?: number;
  }) {
    return this.officialApi.autoTemplateSamples(body);
  }

  @Post('auto-ble-template-samples')
  async autoBleTemplateSamples(@Body() body: {
    apiName?: string;
    apId: string;
    eslCode: string;
    templateId: number;
    sign?: string;
    storeCode?: string;
    fieldName?: string;
    values?: string[];
    productCodePrefix?: string;
    productNamePrefix?: string;
    basePrice?: number;
    timeoutMs?: number;
  }) {
    return this.officialApi.autoBleTemplateSamples(body);
  }

  @Post('direct-and-capture')
  async directAndCapture(@Body() body: {
    apiName?: string;
    apId: string;
    eslCode: string;
    templateId: number;
    sign?: string;
    storeCode?: string;
    product?: Record<string, unknown>;
    timeoutMs?: number;
  }) {
    return this.officialApi.directAndCapture(body);
  }

  @Post('send-image-4515')
  async sendImage4515(@Body() body: {
    apiName?: string;
    apId: string;
    eslCode: string;
    imageUrl: string;
    templateId?: number;
    imageFieldName?: string;
    sign?: string;
    storeCode?: string;
    productCode?: string;
    productName?: string;
    price?: number;
    timeoutMs?: number;
  }) {
    return this.officialApi.sendImage4515(body);
  }

  @Post('send-image-4515-file')
  @UseInterceptors(FileInterceptor('file'))
  async sendImage4515File(
    @UploadedFile() file: { buffer: Buffer; originalname?: string; mimetype?: string; size?: number } | undefined,
    @Body() body: {
      apiName?: string;
      apId: string;
      eslCode: string;
      templateId?: number;
      imageFieldName?: string;
      sign?: string;
      storeCode?: string;
      productCode?: string;
      productName?: string;
      price?: number;
      timeoutMs?: number;
      fourColor?: boolean | string;
    },
  ) {
    return this.officialApi.sendImage4515File(body, file);
  }

  @Post('send-image-4515-file-local')
  @UseInterceptors(FileInterceptor('file'))
  async sendImage4515FileLocal(
    @UploadedFile() file: { buffer: Buffer; originalname?: string; mimetype?: string; size?: number } | undefined,
    @Body() body: {
      apiName?: string;
      apId: string;
      eslCode: string;
      templateId?: number;
      imageFieldName?: string;
      sign?: string;
      storeCode?: string;
      productCode?: string;
      productName?: string;
      price?: number;
      timeoutMs?: number;
      fourColor?: boolean | string;
    },
  ) {
    return this.officialApi.sendImage4515FileLocalOnly(body, file);
  }

  @Post('send-image-4515-file-local-generated')
  @UseInterceptors(FileInterceptor('file'))
  async sendImage4515FileLocalGenerated(
    @UploadedFile() file: { buffer: Buffer; originalname?: string; mimetype?: string; size?: number } | undefined,
    @Body() body: {
      apiName?: string;
      apId: string;
      eslCode: string;
      templateId?: number;
      imageFieldName?: string;
      sign?: string;
      storeCode?: string;
      productCode?: string;
      productName?: string;
      price?: number;
      timeoutMs?: number;
      fourColor?: boolean | string;
      mode?: 'non55' | 'full' | 'f2slot';
      renderMode?: 'full' | 'f2slot' | 'official' | 'service0c_replay' | 'service0c_local';
      fullVariant?: 'single_chunk' | 'stacked_rows' | 'stacked_rows_triple' | 'first_quartet' | 'legacy';
      fullQuartet?: number | string;
      localImageName?: string;
      seedCaptureId?: string;
      sendMode?: 'direct' | 'replay';
      fit?: 'stretch' | 'contain_black' | 'contain_white' | 'cover';
      dither?: boolean | string;
      resample?: 'nearest' | 'bilinear' | 'bicubic' | 'lanczos';
      renderPreset?: string;
      renderScale?: number | string;
      dryRun?: boolean | string;
    },
  ) {
    return this.officialApi.sendImage4515FileLocalGenerated(body, file);
  }

  @Post('send-image-4515-file-local-generated-sweep')
  @UseInterceptors(FileInterceptor('file'))
  async sendImage4515FileLocalGeneratedSweep(
    @UploadedFile() file: { buffer: Buffer; originalname?: string; mimetype?: string; size?: number } | undefined,
    @Body() body: {
      apiName?: string;
      apId: string;
      eslCode: string;
      templateId?: number;
      imageFieldName?: string;
      sign?: string;
      storeCode?: string;
      productCode?: string;
      productName?: string;
      price?: number;
      timeoutMs?: number;
      fourColor?: boolean | string;
      fits?: Array<'stretch' | 'contain_black' | 'contain_white' | 'cover'>;
      resamples?: Array<'nearest' | 'bilinear' | 'bicubic' | 'lanczos'>;
      dithers?: Array<boolean | string>;
      renderPreset?: string;
      renderScale?: number | string;
      topN?: number;
      fastMode?: boolean | string;
    },
  ) {
    return this.officialApi.sweepImage4515FileLocalGenerated(body, file);
  }

  @Post('send-image-4515-file-local-generated-auto-best')
  @UseInterceptors(FileInterceptor('file'))
  async sendImage4515FileLocalGeneratedAutoBest(
    @UploadedFile() file: { buffer: Buffer; originalname?: string; mimetype?: string; size?: number } | undefined,
    @Body() body: {
      apiName?: string;
      apId: string;
      eslCode: string;
      templateId?: number;
      imageFieldName?: string;
      sign?: string;
      storeCode?: string;
      productCode?: string;
      productName?: string;
      price?: number;
      timeoutMs?: number;
      fourColor?: boolean | string;
      sendMode?: 'direct' | 'replay';
      renderMode?: 'full' | 'f2slot' | 'official' | 'service0c_replay' | 'service0c_local';
      fullVariant?: 'single_chunk' | 'stacked_rows' | 'stacked_rows_triple' | 'first_quartet' | 'legacy';
      fullQuartet?: number | string;
      localImageName?: string;
      seedCaptureId?: string;
      dryRun?: boolean | string;
      fits?: Array<'stretch' | 'contain_black' | 'contain_white' | 'cover'>;
      resamples?: Array<'nearest' | 'bilinear' | 'bicubic' | 'lanczos'>;
      dithers?: Array<boolean | string>;
      renderPreset?: string;
      renderScale?: number | string;
      topN?: number;
      fastMode?: boolean | string;
    },
  ) {
    return this.officialApi.sendImage4515FileLocalGeneratedAutoBest(body, file);
  }
}
