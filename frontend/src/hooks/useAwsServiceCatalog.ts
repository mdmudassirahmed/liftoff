/**
 * useAwsServiceCatalog - static AWS service catalog hook.
 * Returns curated AWS services for the service palette.
 */

import { useMemo } from 'react';
import type { AWSService, AWSServiceCategory } from '@/types';
import awsServicesData from '@/data/awsServices.json';

const CURATED_AWS_SERVICES = awsServicesData.services as AWSService[];
const CURATED_AWS_CATEGORIES = awsServicesData.categories as AWSServiceCategory[];

export interface AwsServiceCatalog {
  services: AWSService[];
  categories: AWSServiceCategory[];
  allServices: AWSService[];
}

export function useAwsServiceCatalog(): AwsServiceCatalog {
  const allServices = useMemo(() => CURATED_AWS_SERVICES, []);

  return {
    services: CURATED_AWS_SERVICES,
    categories: CURATED_AWS_CATEGORIES,
    allServices,
  };
}

export default useAwsServiceCatalog;
