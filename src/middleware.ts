import { defineMiddleware } from 'astro:middleware';
import { getWipRedirect } from './config/wip-routes';

export const onRequest = defineMiddleware((context, next) => {
  // En desarrollo local (`astro dev`), emulamos el comportamiento de Cloudflare (_redirects)
  // devolviendo una redirección HTTP 302 directa a /wip o /en/wip.
  //
  // En producción (`astro build`), import.meta.env.DEV es false, por lo que se genera
  // el HTML estático completo de cada página en dist/ y Cloudflare maneja el 302 a nivel de CDN
  // a través de public/_redirects sin mostrar la pantalla intermedia de "Redirecting from...".
  if (import.meta.env.DEV) {
    const wipTarget = getWipRedirect(context.url.pathname);
    if (wipTarget) {
      return context.redirect(wipTarget, 302);
    }
  }

  return next();
});
