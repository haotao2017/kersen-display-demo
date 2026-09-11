import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Marks a LocalCloudController handler as reachable without a bearer token. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
