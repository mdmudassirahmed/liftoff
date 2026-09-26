// Bundled example diagrams from /examples, importable through deep links such as
// /workspace?example=web-app-sql (see AppShell). Vite inlines them at build time.

export interface ExampleDiagram {
  nodes: unknown[];
  edges: unknown[];
}

const modules = import.meta.glob('../../../examples/*.json', { eager: true, import: 'default' }) as Record<
  string,
  ExampleDiagram
>;

function nameFromPath(path: string): string {
  return path.split('/').pop()!.replace(/\.json$/, '');
}

const TITLES: Record<string, string> = {
  'web-app-sql': 'Web App + SQL',
  'serverless-ai': 'Serverless AI',
  'aks-microservices': 'AKS Microservices',
  'aws-serverless-api': 'AWS Serverless API',
};

function titleFromName(name: string): string {
  return (
    TITLES[name] ??
    name
      .split('-')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ')
  );
}

export const EXAMPLES: Record<string, { title: string; diagram: ExampleDiagram }> = Object.fromEntries(
  Object.entries(modules).map(([path, diagram]) => {
    const name = nameFromPath(path);
    return [name, { title: titleFromName(name), diagram }];
  })
);

export function getExample(name: string): { title: string; diagram: ExampleDiagram } | undefined {
  return EXAMPLES[name];
}
