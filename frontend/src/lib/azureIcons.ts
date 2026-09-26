// Azure Service Icon Mapping
// Maps Azure service icon identifiers to Iconify icons

export const azureIconMap: Record<string, string> = {
  // Compute
  'azure:virtual-machine': 'fluent:desktop-20-regular',
  'azure:virtual-machine-scale-set': 'fluent:desktop-pulse-20-regular',
  'azure:availability-set': 'mdi:server-network',
  'azure:disk': 'mdi:harddisk',
  'azure:image': 'mdi:image',
  
  // Web
  'azure:app-service': 'fluent:globe-20-regular',
  'azure:app-service-plan': 'mdi:server',
  'azure:function-app': 'mdi:function-variant',
  'azure:static-web-app': 'mdi:web',
  
  // Containers
  'azure:container-instance': 'mdi:package-variant-closed',
  'azure:container-registry': 'mdi:docker',
  'azure:kubernetes-service': 'mdi:kubernetes',
  'azure:container-app': 'mdi:application-brackets',
  'azure:batch': 'mdi:view-grid-plus',
  
  // Databases
  'azure:sql-database': 'mdi:database',
  'azure:sql-server': 'mdi:database-cog',
  'azure:cosmos-db': 'mdi:database-search',
  'azure:mysql': 'mdi:database-outline',
  'azure:postgresql': 'mdi:elephant',
  'azure:redis-cache': 'mdi:cached',
  
  // Storage
  'azure:storage-account': 'mdi:cloud-upload',
  'azure:blob-storage': 'mdi:file-cloud',
  'azure:file-share': 'mdi:folder-network',
  'azure:queue-storage': 'mdi:tray-full',
  'azure:table-storage': 'mdi:table',
  'azure:data-lake': 'mdi:waves',
  
  // Networking
  'azure:virtual-network': 'mdi:lan',
  'azure:subnet': 'mdi:lan-pending',
  'azure:network-security-group': 'mdi:shield-lock',
  'azure:application-gateway': 'mdi:gate',
  'azure:load-balancer': 'mdi:scale-balance',
  'azure:public-ip': 'mdi:ip-network',
  'azure:dns-zone': 'mdi:dns',
  'azure:private-dns-zone': 'mdi:dns-outline',
  'azure:vpn-gateway': 'mdi:vpn',
  'azure:expressroute': 'mdi:highway',
  'azure:bastion': 'mdi:shield-home',
  'azure:firewall': 'mdi:fire',
  'azure:front-door': 'mdi:door',
  'azure:cdn': 'mdi:access-point-network',
  'azure:traffic-manager': 'mdi:traffic-light',
  'azure:private-endpoint': 'mdi:lock-outline',
  'azure:network-interface': 'mdi:ethernet',
  'azure:nat-gateway': 'mdi:swap-horizontal',
  
  // Security
  'azure:key-vault': 'mdi:key-variant',
  'azure:managed-identity': 'mdi:account-key',
  'azure:active-directory': 'mdi:microsoft-azure',
  'azure:defender': 'mdi:shield-alert',
  'azure:ddos-protection': 'mdi:shield-bug',
  'azure:policy': 'mdi:file-document-check',
  
  // Integration
  'azure:event-hub': 'mdi:hub',
  'azure:service-bus': 'mdi:bus',
  'azure:event-grid': 'mdi:grid',
  'azure:logic-app': 'mdi:sitemap',
  'azure:api-management': 'mdi:api',
  
  // Analytics
  'azure:data-factory': 'mdi:factory',
  'azure:synapse': 'mdi:chart-scatter-plot',
  'azure:stream-analytics': 'mdi:chart-timeline-variant',
  
  // AI
  'azure:cognitive-services': 'mdi:brain',
  'azure:machine-learning': 'mdi:robot',
  'azure:openai': 'mdi:robot-outline',
  'azure:search': 'mdi:magnify',
  'azure:bot-service': 'mdi:robot-happy',
  'azure:form-recognizer': 'mdi:file-eye',
  
  // IoT
  'azure:iot-hub': 'mdi:chip',
  'azure:digital-twins': 'mdi:vector-triangle',
  
  // DevOps
  'azure:devops': 'mdi:microsoft-azure-devops',
  'azure:app-configuration': 'mdi:cog',
  'azure:automation': 'mdi:robot-industrial',
  
  // Monitor
  'azure:monitor': 'mdi:monitor-eye',
  'azure:application-insights': 'mdi:chart-line',
  'azure:log-analytics': 'mdi:text-search',
  'azure:alerts': 'mdi:bell-alert',
  
  // Mobile
  'azure:notification-hub': 'mdi:bell-ring',
  'azure:app-center': 'mdi:cellphone-cog',
  
  // Hybrid
  'azure:arc': 'mdi:transit-connection-variant',
  'azure:stack': 'mdi:layers',
};

/**
 * Get the Iconify icon name for an Azure service icon path
 */
export function getAzureServiceIcon(iconPath: string | undefined): string {
  if (!iconPath) return 'mdi:cube-outline';
  
  // If already an MDI icon (direct iconify format), return as-is
  if (iconPath.startsWith('mdi:')) {
    return iconPath;
  }
  
  if (azureIconMap[iconPath]) {
    return azureIconMap[iconPath];
  }
  
  // Fallback for unknown icons
  return 'mdi:cube-outline';
}
