import { SyncService } from './lib/service.js';
import { createRoutes } from './lib/routes.js';
import { createTools } from './lib/tools.js';
import { defaultDshHome, defaultProfileDir, defaultProfileName } from './lib/util.js';

/** Stable plugin name, used by the bundle patch. */
export const name = 'plugin-sync';

/** The settings route family and the five tools need these Host services. */
export const inject = ['tools', 'webServer'];

/**
 * Mount the plugin-sync host half: a settings API and model-facing tools that
 * export the local profile's plugin state and push it to another node.
 */
export function apply(ctx, config = {}) {
  if (config.enabled === false) return;
  const service = new SyncService({
    dshHome: config.dshHome || defaultDshHome(),
    profileDir: config.profileDir || defaultProfileDir(),
    profile: config.profile || defaultProfileName(),
  });
  for (const route of createRoutes(service)) {
    ctx.effect(() => ctx.webServer.register(route));
  }
  for (const tool of createTools(service)) {
    ctx.effect(() => ctx.tools.register(tool));
  }
  ctx.logger?.info?.('plugin-sync mounted for profile %s', service.profile);
}
