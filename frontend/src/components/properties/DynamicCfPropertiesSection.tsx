import { useState, useEffect } from 'react';
import { Icon } from '@iconify/react';
import { cn } from '@/lib/utils';

const API_BASE = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000';

// Services with VPC integration - show VPC section expanded by default
const VPC_CAPABLE_TYPES = new Set([
  'AWS::Lambda::Function',
  'AWS::ECS::TaskDefinition',
  'AWS::ECS::Service',
  'AWS::RDS::DBInstance',
  'AWS::RDS::DBCluster',
  'AWS::ElastiCache::CacheCluster',
  'AWS::Redshift::Cluster',
  'AWS::AutoScaling::AutoScalingGroup',
  'AWS::EC2::Instance',
]);

const VPC_PROPERTY_NAMES = new Set(['VpcConfig', 'SubnetId', 'SubnetIds', 'VPCZoneIdentifier']);

// Sensible production defaults for common AWS resource types
const PRODUCTION_DEFAULTS: Record<string, Record<string, unknown>> = {
  'AWS::Lambda::Function': {
    Runtime: 'python3.14',
    MemorySize: 128,
    Timeout: 60,
    Handler: 'lambda_function.lambda_handler',
    Architecture: 'x86_64',
    'EphemeralStorage.Size': 512,
  },
  'AWS::SQS::Queue': {
    VisibilityTimeout: 900,
    MessageRetentionPeriod: 345600,
    DelaySeconds: 0,
    MaximumMessageSize: 1048576,
    ReceiveMessageWaitTimeSeconds: 0,
  },
  'AWS::S3::Bucket': {
    VersioningConfiguration: { Status: 'Enabled' },
    PublicAccessBlockConfiguration: {
      BlockPublicAcls: true,
      BlockPublicPolicy: true,
      IgnorePublicAcls: true,
      RestrictPublicBuckets: true,
    },
  },
  'AWS::DynamoDB::Table': {
    BillingMode: 'PAY_PER_REQUEST',
    DeletionProtectionEnabled: true,
    PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
    SSESpecification: { SSEEnabled: true },
  },
  'AWS::RDS::DBInstance': {
    DBInstanceClass: 'db.t3.medium',
    Engine: 'postgres',
    EngineVersion: '16.3',
    MultiAZ: true,
    StorageEncrypted: true,
    BackupRetentionPeriod: 7,
    DeletionProtection: true,
    AllocatedStorage: 20,
    StorageType: 'gp3',
  },
  'AWS::ECS::Cluster': {
    CapacityProviders: ['FARGATE', 'FARGATE_SPOT'],
  },
  'AWS::ECS::TaskDefinition': {
    NetworkMode: 'awsvpc',
    RequiresCompatibilities: ['FARGATE'],
    Cpu: '256',
    Memory: '512',
  },
  'AWS::KMS::Key': {
    EnableKeyRotation: true,
    KeyUsage: 'ENCRYPT_DECRYPT',
    PendingWindowInDays: 30,
  },
  'AWS::SecretsManager::Secret': {
    PasswordLength: 24,
    ExcludeCharacters: '@/\\',
  },
  'AWS::Glue::Job': {
    GlueVersion: '4.0',
    MaxRetries: 3,
    Timeout: 2880,
    MaxConcurrentRuns: 100,
  },
};

// Required-field defaults so a freshly added resource produces a valid template.
// These are seeded at LOWEST priority so PRODUCTION_DEFAULTS and schema values still win.
// REPLACE_ME tokens are intentional: they keep the required counter green (non-empty)
// while making it obvious the user must supply a real value before deploying.
const REQUIRED_DEFAULTS: Record<string, Record<string, unknown>> = {
  'AWS::Lambda::Function': {
    Code: { ZipFile: "def lambda_handler(event, context):\n    return 'Hello from Liftoff'" },
    Role: 'arn:aws:iam::ACCOUNT_ID:role/service-role/REPLACE_ME-lambda-role',
    Runtime: 'python3.14',
    Handler: 'lambda_function.lambda_handler',
  },
  'AWS::EC2::Instance': {
    ImageId: 'ami-0abcdef1234567890',
    InstanceType: 't3.micro',
  },
  'AWS::IAM::Role': {
    AssumeRolePolicyDocument: {
      Version: '2012-10-17',
      Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }],
    },
    Path: '/service-role/',
  },
  'AWS::KMS::Key': {
    KeyPolicy: {
      Version: '2012-10-17',
      Statement: [{ Sid: 'Enable IAM User Permissions', Effect: 'Allow', Principal: { AWS: 'arn:aws:iam::ACCOUNT_ID:root' }, Action: 'kms:*', Resource: '*' }],
    },
  },
  'AWS::DynamoDB::Table': {
    KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
    AttributeDefinitions: [{ AttributeName: 'id', AttributeType: 'S' }],
  },
  'AWS::DynamoDB::GlobalTable': {
    KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
    AttributeDefinitions: [{ AttributeName: 'id', AttributeType: 'S' }],
    Replicas: [{ Region: 'us-east-1' }],
  },
  'AWS::ECS::TaskDefinition': {
    ContainerDefinitions: [{ Name: 'app-container', Image: 'REPLACE_ME:latest', Essential: true, Memory: 512, Cpu: 256 }],
  },
  'AWS::EKS::Cluster': {
    RoleArn: 'arn:aws:iam::ACCOUNT_ID:role/REPLACE_ME-eks-cluster-role',
    ResourcesVpcConfig: { SubnetIds: ['subnet-REPLACE_ME_1', 'subnet-REPLACE_ME_2'], EndpointPrivateAccess: true, EndpointPublicAccess: false },
  },
  'AWS::Redshift::Cluster': {
    MasterUsername: 'admin',
    MasterUserPassword: 'REPLACE_ME_Password1!',
    DBName: 'mydb',
    ClusterType: 'multi-node',
    NodeType: 'ra3.xlplus',
    NumberOfNodes: 2,
  },
  'AWS::Glue::Job': {
    Command: { Name: 'glueetl', ScriptLocation: 's3://REPLACE_ME-bucket/scripts/job.py', PythonVersion: '3' },
    Role: 'arn:aws:iam::ACCOUNT_ID:role/REPLACE_ME-glue-role',
  },
  'AWS::Athena::WorkGroup': {
    Name: 'liftoff-dev-workgroup',
  },
  'AWS::StepFunctions::StateMachine': {
    RoleArn: 'arn:aws:iam::ACCOUNT_ID:role/REPLACE_ME-stepfunctions-role',
  },
  'AWS::ApiGateway::RestApi': {
    Name: 'liftoff-dev-api',
  },
  'AWS::ApiGatewayV2::Api': {
    Name: 'liftoff-dev-http-api',
    ProtocolType: 'HTTP',
  },
  'AWS::ElasticLoadBalancingV2::LoadBalancer': {
    Subnets: ['subnet-REPLACE_ME_1', 'subnet-REPLACE_ME_2'],
  },
  'AWS::Bedrock::Agent': {
    AgentName: 'liftoff-dev-agent',
    AgentResourceRoleArn: 'arn:aws:iam::ACCOUNT_ID:role/REPLACE_ME-bedrock-agent-role',
  },
  'AWS::SageMaker::Model': {
    ExecutionRoleArn: 'arn:aws:iam::ACCOUNT_ID:role/REPLACE_ME-sagemaker-role',
  },
  'AWS::Lambda::EventSourceMapping': {
    EventSourceArn: 'arn:aws:sqs:us-east-1:ACCOUNT_ID:REPLACE_ME-queue',
    FunctionName: 'REPLACE_ME-function-name',
  },
  'AWS::SQS::QueuePolicy': {
    PolicyDocument: {
      Version: '2012-10-17',
      Statement: [{ Effect: 'Allow', Principal: { Service: 'sns.amazonaws.com' }, Action: 'sqs:SendMessage', Resource: '*' }],
    },
    Queues: ['REPLACE_ME-queue-url'],
  },
};

const CF_ENUM_OPTIONS: Record<string, { value: string; label: string }[]> = {
  Runtime: [
    { value: 'python3.14', label: 'Python 3.14 (Recommended)' },
    { value: 'python3.12', label: 'Python 3.12' },
    { value: 'python3.11', label: 'Python 3.11' },
    { value: 'nodejs22.x', label: 'Node.js 22.x' },
    { value: 'nodejs20.x', label: 'Node.js 20.x' },
    { value: 'java21', label: 'Java 21' },
    { value: 'java17', label: 'Java 17' },
    { value: 'dotnet8', label: '.NET 8' },
    { value: 'go1.x', label: 'Go 1.x' },
  ],
  Architecture: [
    { value: 'x86_64', label: 'x86_64 (Recommended)' },
    { value: 'arm64', label: 'arm64 (Graviton)' },
  ],
  Engine: [
    { value: 'postgres', label: 'PostgreSQL (Recommended)' },
    { value: 'mysql', label: 'MySQL' },
    { value: 'aurora-mysql', label: 'Aurora MySQL' },
    { value: 'aurora-postgresql', label: 'Aurora PostgreSQL' },
    { value: 'sqlserver-ex', label: 'SQL Server Express' },
    { value: 'sqlserver-se', label: 'SQL Server Standard' },
    { value: 'sqlserver-ee', label: 'SQL Server Enterprise' },
    { value: 'mariadb', label: 'MariaDB' },
    { value: 'oracle-se2', label: 'Oracle SE2' },
  ],
  DBInstanceClass: [
    { value: 'db.t3.micro', label: 'db.t3.micro (2 vCPU, 1 GB - dev/test only)' },
    { value: 'db.t3.small', label: 'db.t3.small (2 vCPU, 2 GB)' },
    { value: 'db.t3.medium', label: 'db.t3.medium (2 vCPU, 4 GB)' },
    { value: 'db.t3.large', label: 'db.t3.large (2 vCPU, 8 GB)' },
    { value: 'db.m5.large', label: 'db.m5.large (2 vCPU, 8 GB)' },
    { value: 'db.m5.xlarge', label: 'db.m5.xlarge (4 vCPU, 16 GB)' },
    { value: 'db.r5.large', label: 'db.r5.large (2 vCPU, 16 GB - memory optimized)' },
    { value: 'db.r5.xlarge', label: 'db.r5.xlarge (4 vCPU, 32 GB)' },
  ],
  StorageType: [
    { value: 'gp3', label: 'gp3 (General Purpose SSD - Recommended)' },
    { value: 'gp2', label: 'gp2 (Legacy General Purpose SSD)' },
    { value: 'io1', label: 'io1 (Provisioned IOPS)' },
  ],
  BillingMode: [
    { value: 'PAY_PER_REQUEST', label: 'On-Demand (PAY_PER_REQUEST) - recommended' },
    { value: 'PROVISIONED', label: 'Provisioned' },
  ],
  TableClass: [
    { value: 'STANDARD', label: 'Standard' },
    { value: 'STANDARD_INFREQUENT_ACCESS', label: 'Standard Infrequent Access' },
  ],
  NetworkMode: [
    { value: 'awsvpc', label: 'awsvpc (Required for Fargate)' },
    { value: 'bridge', label: 'bridge' },
    { value: 'host', label: 'host' },
  ],
  LaunchType: [
    { value: 'FARGATE', label: 'Fargate (Serverless - Recommended)' },
    { value: 'EC2', label: 'EC2' },
  ],
  MultiAZ: [
    { value: 'true', label: 'Yes - Multi-AZ (Required for production)' },
    { value: 'false', label: 'No - Single AZ (Dev/test only)' },
  ],
  StorageEncrypted: [
    { value: 'true', label: 'Yes - Encrypted (recommended)' },
    { value: 'false', label: 'No - Unencrypted (NOT recommended)' },
  ],
  DeletionProtection: [
    { value: 'true', label: 'Yes - Enable (Recommended for production)' },
    { value: 'false', label: 'No - Allow deletion' },
  ],
  SqsManagedSseEnabled: [
    { value: 'true', label: 'Yes - SSE Enabled (Recommended)' },
    { value: 'false', label: 'No' },
  ],
  FifoQueue: [
    { value: 'true', label: 'Yes - FIFO (Ordered, exactly-once)' },
    { value: 'false', label: 'No - Standard (Higher throughput)' },
  ],
  GlueVersion: [
    { value: '4.0', label: '4.0 (Recommended)' },
    { value: '3.0', label: '3.0' },
  ],
  KeyUsage: [
    { value: 'ENCRYPT_DECRYPT', label: 'Encrypt/Decrypt (Default)' },
    { value: 'SIGN_VERIFY', label: 'Sign/Verify' },
    { value: 'GENERATE_VERIFY_MAC', label: 'Generate/Verify MAC' },
  ],
};

// Known boolean properties - stored as boolean, not string
const BOOLEAN_CF_PROPS = new Set([
  'MultiAZ', 'StorageEncrypted', 'DeletionProtection', 'DeletionProtectionEnabled',
  'SqsManagedSseEnabled', 'FifoQueue', 'EnableKeyRotation', 'PointInTimeRecoveryEnabled',
  'SSEEnabled', 'BlockPublicAcls', 'BlockPublicPolicy', 'IgnorePublicAcls', 'RestrictPublicBuckets',
  'VersioningEnabled', 'ContentBasedDeduplication',
]);

function formatPropName(key: string): string {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase()).trim();
}

interface CfSchema {
  resourceType: string;
  name: string;
  cfProperties: { required: string[]; optional: string[] };
  defaultProperties: Record<string, unknown>;
}

interface DynamicCfPropertiesSectionProps {
  resourceType: string;
  properties: Record<string, unknown>;
  onPropertyUpdate: (key: string, value: unknown) => void;
}

export function DynamicCfPropertiesSection({
  resourceType,
  properties,
  onPropertyUpdate,
}: DynamicCfPropertiesSectionProps) {
  const [schema, setSchema] = useState<CfSchema | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showOptional, setShowOptional] = useState(false);
  // VPC section open by default for VPC-capable services
  const [showVpc, setShowVpc] = useState(() => VPC_CAPABLE_TYPES.has(resourceType));

  useEffect(() => {
    if (!resourceType) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setShowVpc(VPC_CAPABLE_TYPES.has(resourceType));

    fetch(`${API_BASE}/api/agents/aws/cf-schema?resourceType=${encodeURIComponent(resourceType)}`, {
      signal: controller.signal,
    })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<CfSchema>;
      })
      .then((data) => {
        setSchema(data);
        setLoading(false);

        // Auto-populate missing defaults - REQUIRED_DEFAULTS at lowest priority so
        // prodDefaults and schema values always override them.
        const requiredDefaults = REQUIRED_DEFAULTS[resourceType] || {};
        const prodDefaults = PRODUCTION_DEFAULTS[resourceType] || {};
        const schemaDefaults = data.defaultProperties || {};
        const merged = { ...requiredDefaults, ...prodDefaults, ...schemaDefaults };
        Object.entries(merged).forEach(([k, v]) => {
          if (properties[k] === undefined || properties[k] === '' || properties[k] === null) {
            onPropertyUpdate(k, v);
          }
        });
      })
      .catch((e) => {
        if (e.name !== 'AbortError') {
          setError(String(e));
          setLoading(false);
        }
      });

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resourceType]);

  const getValue = (key: string): unknown => {
    if (properties[key] !== undefined) return properties[key];
    const prodDefault = PRODUCTION_DEFAULTS[resourceType]?.[key];
    if (prodDefault !== undefined) return prodDefault;
    const schemaDefault = schema?.defaultProperties?.[key];
    if (schemaDefault !== undefined) return schemaDefault;
    return REQUIRED_DEFAULTS[resourceType]?.[key] ?? '';
  };

  const isFilled = (v: unknown): boolean => {
    if (v === undefined || v === null || v === '') return false;
    if (typeof v === 'object') return Object.keys(v as object).length > 0;
    return true;
  };

  const handleUpdate = (key: string, rawValue: unknown) => {
    // Coerce string "true"/"false" to boolean for known boolean CF properties
    if (BOOLEAN_CF_PROPS.has(key) && (rawValue === 'true' || rawValue === 'false')) {
      onPropertyUpdate(key, rawValue === 'true');
    } else {
      onPropertyUpdate(key, rawValue);
    }
  };

  const renderField = (key: string, required: boolean) => {
    const value = getValue(key);
    const filled = isFilled(value);
    const enumOptions = CF_ENUM_OPTIONS[key];
    const isBool = BOOLEAN_CF_PROPS.has(key);
    const hasDefault = REQUIRED_DEFAULTS[resourceType]?.[key] !== undefined ||
      PRODUCTION_DEFAULTS[resourceType]?.[key] !== undefined ||
      schema?.defaultProperties?.[key] !== undefined;

    return (
      <div key={key} className="group">
        <label className="flex items-center gap-1.5 text-xs font-medium text-gray-700 mb-1">
          {formatPropName(key)}
          {required && (
            <span
              className={cn('text-base leading-none', filled ? 'text-green-500' : 'text-orange-500')}
              title={filled ? 'Required - filled' : 'Required - please fill'}
            >
              *
            </span>
          )}
          {hasDefault && !required && (
            <span className="text-[9px] bg-[#FF9900]/10 text-[#FF9900] px-1 rounded font-normal">default</span>
          )}
        </label>

        {enumOptions ? (
          <select
            value={String(value)}
            onChange={(e) => handleUpdate(key, e.target.value)}
            className={cn(
              'w-full px-3 py-2 text-sm border rounded-md focus:outline-none focus:ring-2 focus:ring-[#FF9900] focus:border-transparent bg-white',
              required && !filled ? 'border-orange-300' : 'border-gray-300'
            )}
          >
            <option value="">Select...</option>
            {enumOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        ) : isBool ? (
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={Boolean(value)}
              onChange={(e) => handleUpdate(key, e.target.checked)}
              className="rounded border-gray-300 text-[#FF9900] focus:ring-[#FF9900] w-4 h-4"
            />
            <span className="text-sm text-gray-600">{value ? 'Yes' : 'No'}</span>
          </label>
        ) : typeof value === 'object' && value !== null ? (
          <textarea
            value={JSON.stringify(value, null, 2)}
            onChange={(e) => {
              try { handleUpdate(key, JSON.parse(e.target.value)); } catch { handleUpdate(key, e.target.value); }
            }}
            rows={3}
            className={cn('w-full px-3 py-2 text-sm font-mono border rounded-md focus:outline-none focus:ring-2 focus:ring-[#FF9900]', required && !filled ? 'border-orange-300' : 'border-gray-300')}
          />
        ) : (
          <input
            type="text"
            value={String(value)}
            onChange={(e) => handleUpdate(key, e.target.value)}
            placeholder={hasDefault ? `Default: ${String(PRODUCTION_DEFAULTS[resourceType]?.[key] ?? schema?.defaultProperties?.[key] ?? REQUIRED_DEFAULTS[resourceType]?.[key] ?? '')}` : `Enter ${formatPropName(key)}`}
            className={cn('w-full px-3 py-2 text-sm border rounded-md focus:outline-none focus:ring-2 focus:ring-[#FF9900]', required && !filled ? 'border-orange-300' : 'border-gray-300')}
          />
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <section>
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Configuration</h3>
        <div className="flex items-center gap-2 text-sm text-gray-500 py-4">
          <Icon icon="mdi:loading" className="w-4 h-4 animate-spin text-[#FF9900]" />
          <span>Loading CloudFormation schema...</span>
        </div>
      </section>
    );
  }

  if (error || !schema) {
    return (
      <section>
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Configuration</h3>
        <div className="text-xs text-amber-600 bg-amber-50 px-2 py-1.5 rounded mb-2">
          <Icon icon="mdi:alert" className="inline w-3 h-3 mr-1" />
          Schema unavailable - enter properties manually
        </div>
        <FallbackPropertiesEditor resourceType={resourceType} properties={properties} onPropertyUpdate={handleUpdate} />
      </section>
    );
  }

  const required = schema.cfProperties.required;
  const optional = schema.cfProperties.optional;
  const vpcProps = optional.filter((k) => VPC_PROPERTY_NAMES.has(k));
  const nonVpcOptional = optional.filter((k) => !VPC_PROPERTY_NAMES.has(k));

  const filterProps = (keys: string[]) => {
    if (!searchQuery.trim()) return keys;
    const q = searchQuery.toLowerCase();
    return keys.filter((k) => k.toLowerCase().includes(q) || formatPropName(k).toLowerCase().includes(q));
  };

  const filteredRequired = filterProps(required);
  const filteredOptional = filterProps(nonVpcOptional);

  const requiredFilled = required.filter((k) => isFilled(getValue(k))).length;

  return (
    <section>
      {/* Header */}
      <div className="bg-gradient-to-r from-[#FF9900]/10 to-[#FF9900]/5 -mx-4 px-4 py-2 mb-3 border-b border-[#FF9900]/20">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-gray-800 uppercase tracking-wider">Configuration</h3>
          <span className="text-[10px] text-[#FF9900] font-medium">CloudFormation</span>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-gray-500 mt-0.5">
          <Icon icon="mdi:aws" className="w-3 h-3 text-[#FF9900]" />
          <span>{schema.name}</span>
          {required.length > 0 && (
            <span className={cn('ml-auto', requiredFilled === required.length ? 'text-green-600' : 'text-orange-600')}>
              {requiredFilled}/{required.length} required filled
            </span>
          )}
        </div>
      </div>

      {/* Search */}
      {(required.length + optional.length) > 6 && (
        <div className="relative mb-3">
          <Icon icon="mdi:magnify" className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#FF9900]" />
          <input
            type="text"
            placeholder="Search properties..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-8 py-2 text-xs border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-[#FF9900]/30 placeholder:text-gray-400"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <Icon icon="mdi:close" className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      <div className="space-y-3">
        {/* Required fields */}
        {filteredRequired.length > 0 && (
          <>
            <p className="text-[10px] text-gray-400 uppercase tracking-wider">Required</p>
            {filteredRequired.map((k) => renderField(k, true))}
          </>
        )}

        {/* Optional toggle */}
        {filteredOptional.length > 0 && (
          <>
            <button
              onClick={() => setShowOptional((v) => !v)}
              className="w-full flex items-center justify-between text-xs text-gray-500 py-1.5 border-t border-gray-200 mt-2 hover:text-gray-700 transition-colors"
            >
              <span>Optional configuration ({filteredOptional.length})</span>
              <Icon icon={showOptional ? 'mdi:chevron-up' : 'mdi:chevron-down'} className="w-4 h-4" />
            </button>
            {showOptional && (
              <div className="space-y-3">
                {filteredOptional.map((k) => renderField(k, false))}
              </div>
            )}
          </>
        )}

        {searchQuery && filteredRequired.length === 0 && filteredOptional.length === 0 && (
          <p className="text-xs text-gray-400 text-center py-2 italic">No properties match "{searchQuery}"</p>
        )}
      </div>

      {/* VPC Configuration - visible by default for VPC-capable services */}
      {vpcProps.length > 0 && (
        <div className="mt-4 rounded-md border border-purple-200 bg-purple-50/50">
          <button
            onClick={() => setShowVpc((v) => !v)}
            className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-purple-800 hover:bg-purple-50 transition-colors rounded-md"
          >
            <span className="flex items-center gap-1.5">
              <Icon icon="mdi:network" className="w-3.5 h-3.5" />
              VPC Configuration
              {VPC_CAPABLE_TYPES.has(resourceType) && (
                <span className="text-[9px] bg-purple-200 text-purple-700 px-1 rounded">Required for this service</span>
              )}
            </span>
            <Icon icon={showVpc ? 'mdi:chevron-up' : 'mdi:chevron-down'} className="w-4 h-4" />
          </button>
          {showVpc && (
            <div className="px-3 pb-3 space-y-3">
              <div className="flex items-start gap-1.5 p-2 bg-purple-100/60 rounded-md">
                <Icon icon="mdi:shield-lock-outline" className="w-4 h-4 text-purple-600 mt-0.5 shrink-0" />
                <p className="text-[10px] text-purple-700 leading-snug">
                  Reference the IDs of an existing VPC and subnets below.
                  Your template will not create these resources.
                  <br />
                  <strong>Subnet ID format:</strong> subnet-xxxxxxxxxxxxxxxxx (17 chars)
                </p>
              </div>
              {vpcProps.map((k) => (
                <div key={k}>
                  <label className="flex items-center gap-1 text-xs font-medium text-purple-700 mb-1">
                    <Icon icon="mdi:link" className="w-3 h-3" />
                    {formatPropName(k)}
                    <span className="text-[9px] text-purple-400 font-normal ml-1">existing</span>
                  </label>
                  <input
                    type="text"
                    value={String(getValue(k))}
                    onChange={(e) => handleUpdate(k, e.target.value)}
                    placeholder={
                      k === 'VpcConfig'
                        ? '{"SubnetIds": ["subnet-0712408487d46fed6", "subnet-096d4965eb16389bc"], "SecurityGroupIds": ["sg-xxxxxxxxxxxxxxxxx"]}'
                        : k === 'VPCZoneIdentifier'
                        ? 'subnet-0712408487d46fed6,subnet-096d4965eb16389bc'
                        : 'subnet-xxxxxxxxxxxxxxxxx'
                    }
                    className="w-full px-3 py-2 text-sm border border-purple-200 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-300 bg-white font-mono text-xs"
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// Fallback with production defaults when API is unreachable
interface FallbackPropertiesEditorProps {
  resourceType: string;
  properties: Record<string, unknown>;
  onPropertyUpdate: (key: string, value: unknown) => void;
}

function FallbackPropertiesEditor({ resourceType, properties, onPropertyUpdate }: FallbackPropertiesEditorProps) {
  const prodDefaults = PRODUCTION_DEFAULTS[resourceType] || {};
  const merged = { ...prodDefaults, ...properties };
  const entries = Object.entries(merged);
  if (entries.length === 0) return null;
  return (
    <div className="space-y-3 mt-3">
      {entries.map(([key, value]) => (
        <div key={key}>
          <label className="block text-xs font-medium text-gray-700 mb-1">{formatPropName(key)}</label>
          {typeof value === 'boolean' ? (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={value} onChange={(e) => onPropertyUpdate(key, e.target.checked)} className="rounded border-gray-300 w-4 h-4" />
              <span className="text-sm text-gray-600">{value ? 'Yes' : 'No'}</span>
            </label>
          ) : typeof value === 'object' && value !== null ? (
            <textarea
              value={JSON.stringify(value, null, 2)}
              onChange={(e) => { try { onPropertyUpdate(key, JSON.parse(e.target.value)); } catch { /* invalid json */ } }}
              rows={3}
              className="w-full px-3 py-2 text-sm font-mono border border-gray-300 rounded-md"
            />
          ) : (
            <input type="text" value={String(value)} onChange={(e) => onPropertyUpdate(key, e.target.value)} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md" />
          )}
        </div>
      ))}
    </div>
  );
}

export default DynamicCfPropertiesSection;
