import { prisma } from '../../config/db.js';

const FEATURE_DEFAULTS: Record<string, boolean> = {
  TUTOR_ENABLED: true,
  SPONSORED_PATHWAYS_ENABLED: true,
  VERIFIER_WIDGET_ENABLED: true,
  PROCTORING_ENABLED: true,
};

export const featureFlags = {
  async isEnabled(name: string, scope?: string): Promise<boolean> {
    // 1. Check env var first: FEATURE_<NAME>
    const envKey = `FEATURE_${name.toUpperCase()}`;
    if (process.env[envKey] !== undefined) {
      return process.env[envKey] === 'true';
    }
    // 2. Check DB row with scope
    if (scope) {
      const scoped = await prisma.featureFlag.findFirst({ where: { name, scope } });
      if (scoped) return scoped.enabled;
    }
    // 3. Check DB row global (scope = null)
    const global_ = await prisma.featureFlag.findFirst({ where: { name, scope: null } });
    if (global_) return global_.enabled;
    // 4. Default
    return FEATURE_DEFAULTS[name] ?? false;
  },
};
