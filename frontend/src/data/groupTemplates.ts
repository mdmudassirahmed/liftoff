import type { GroupTemplate, GroupType, VisualTemplate } from '@/types';
import type { CSP } from '@/types';

// Extend GroupTemplate with optional CSP field so AWS groups can be gated.
export interface GroupTemplateWithCSP extends GroupTemplate {
  csp?: CSP;
}

export const groupTemplates: GroupTemplateWithCSP[] = [
  {
    id: 'subscription',
    name: 'Subscription',
    groupType: 'subscription',
    defaultSize: { width: 800, height: 600 },
    color: '#F59E0B',
    iconPath: 'azure:subscriptions',
    description: 'Azure Subscription boundary - top-level billing and access container',
  },
  {
    id: 'region',
    name: 'Region',
    groupType: 'region',
    defaultSize: { width: 700, height: 500 },
    color: '#10B981',
    iconPath: 'azure:region',
    description: 'Azure Region boundary - geographic location for resources',
  },
  {
    id: 'resource-group',
    name: 'Resource Group',
    groupType: 'resourceGroup',
    defaultSize: { width: 500, height: 350 },
    color: '#0078D4',
    iconPath: 'azure:resource-groups',
    description: 'Azure Resource Group - logical container for related resources',
  },
  {
    id: 'virtual-network',
    name: 'Virtual Network',
    groupType: 'virtualNetwork',
    defaultSize: { width: 450, height: 300 },
    color: '#3B82F6',
    iconPath: 'azure:virtual-network',
    description: 'Azure Virtual Network for private networking',
  },
  {
    id: 'subnet',
    name: 'Subnet',
    groupType: 'subnet',
    defaultSize: { width: 350, height: 220 },
    color: '#6366F1',
    iconPath: 'azure:subnet',
    description: 'Subnet within a Virtual Network',
  },
  {
    id: 'availability-zone',
    name: 'Availability Zone',
    groupType: 'availabilityZone',
    defaultSize: { width: 380, height: 250 },
    color: '#8B5CF6',
    iconPath: 'azure:availability-zones',
    description: 'Availability Zone for high availability',
  },
  // AWS group templates
  {
    id: 'aws-account',
    name: 'AWS Account',
    groupType: 'awsAccount',
    defaultSize: { width: 900, height: 700 },
    color: '#FF9900',
    iconPath: 'mdi:cloud-outline',
    description: 'AWS Account boundary',
    csp: 'aws',
  },
  {
    id: 'aws-region',
    name: 'AWS Region',
    groupType: 'awsRegion',
    defaultSize: { width: 750, height: 550 },
    color: '#232F3E',
    iconPath: 'mdi:map-marker-outline',
    description: 'AWS Region (e.g. us-east-1)',
    csp: 'aws',
  },
  {
    id: 'aws-vpc',
    name: 'VPC (existing)',
    groupType: 'awsVpc',
    defaultSize: { width: 600, height: 400 },
    color: '#8C4FFF',
    iconPath: 'mdi:network-outline',
    description: 'Existing VPC owned by your network team - referenced, not created',
    csp: 'aws',
  },
  {
    id: 'aws-subnet',
    name: 'Subnet (existing)',
    groupType: 'awsSubnet',
    defaultSize: { width: 400, height: 250 },
    color: '#1A73E8',
    iconPath: 'mdi:lan-connect',
    description: 'Existing subnet owned by your network team - referenced, not created',
    csp: 'aws',
  },
];

export const groupColors: Record<GroupType, string> = {
  resourceGroup: '#0078D4',
  virtualNetwork: '#3B82F6',
  subnet: '#6366F1',
  region: '#10B981',
  subscription: '#F59E0B',
  availabilityZone: '#8B5CF6',
  awsAccount: '#FF9900',
  awsRegion: '#232F3E',
  awsVpc: '#8C4FFF',
  awsSubnet: '#1A73E8',
};

export const groupLabels: Record<GroupType, string> = {
  resourceGroup: 'Resource Group',
  virtualNetwork: 'Virtual Network',
  subnet: 'Subnet',
  region: 'Region',
  subscription: 'Subscription',
  availabilityZone: 'Availability Zone',
  awsAccount: 'AWS Account',
  awsRegion: 'AWS Region',
  awsVpc: 'VPC (existing)',
  awsSubnet: 'Subnet (existing)',
};

export function getGroupTemplate(groupType: GroupType): GroupTemplate | undefined {
  return groupTemplates.find(t => t.groupType === groupType);
}

export function getGroupColor(groupType: GroupType): string {
  return groupColors[groupType] || '#6B7280';
}

export function getGroupLabel(groupType: GroupType): string {
  return groupLabels[groupType] || groupType;
}

// Visual-only elements (not exported to IaC - for diagram visualization only)
export const visualTemplates: VisualTemplate[] = [
  {
    id: 'user',
    name: 'User',
    iconPath: 'mdi:account-circle',
    color: '#6366F1',
    description: 'Represents end users accessing the system',
  },
  {
    id: 'internet',
    name: 'Internet',
    iconPath: 'mdi:web',
    color: '#0EA5E9',
    description: 'Represents public internet connectivity',
  },
  {
    id: 'on-premises',
    name: 'On-Premises',
    iconPath: 'mdi:server-network',
    color: '#F59E0B',
    description: 'Represents on-premises data center',
  },
  {
    id: 'mobile-user',
    name: 'Mobile User',
    iconPath: 'mdi:cellphone',
    color: '#8B5CF6',
    description: 'Represents mobile app users',
  },
];
