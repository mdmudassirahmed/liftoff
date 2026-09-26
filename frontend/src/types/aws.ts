// AWS Service Types

export interface CFProperties {
  required: string[];
  optional: string[];
}

export interface AWSService {
  id: string;
  name: string;
  resourceType: string;
  category: AWSServiceCategory;
  iconPath: string;
  defaultProperties: Record<string, unknown>;
  cfProperties?: CFProperties;
  description?: string;
}

export type AWSServiceCategory =
  | 'Compute'
  | 'Storage'
  | 'Databases'
  | 'AI'
  | 'Analytics'
  | 'Security'
  | 'Integration'
  | 'Monitoring'
  | 'Networking'
  | 'Other';

export interface AWSServiceCatalog {
  services: AWSService[];
  categories: AWSServiceCategory[];
}

// AWS group types used as diagram containers.
// VPC/Subnet are reference-only (pre-existing networking; not created by IaC).
export type AWSGroupType =
  | 'awsAccount'
  | 'awsRegion'
  | 'awsVpc'       // reference only - pre-existing
  | 'awsSubnet';   // reference only - pre-existing

// Networking resource types that landing-zone mode references instead of creating. Used for validation UI.
export const AWS_FORBIDDEN_RESOURCE_TYPES = [
  'AWS::EC2::VPC',
  'AWS::EC2::Subnet',
  'AWS::EC2::InternetGateway',
  'AWS::EC2::NatGateway',
  'AWS::EC2::RouteTable',
  'AWS::EC2::RouteTableAssociation',
  'AWS::EC2::SecurityGroup',
  'AWS::Route53::HostedZone',
  'AWS::EC2::TransitGateway',
  'AWS::EC2::TransitGatewayAttachment',
  'AWS::EC2::VPCPeeringConnection',
  'AWS::DirectConnect::Connection',
] as const;

export type AWSForbiddenResourceType = typeof AWS_FORBIDDEN_RESOURCE_TYPES[number];
