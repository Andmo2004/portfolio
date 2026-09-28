// src/config/wip-routes.ts
// Configuración centralizada de rutas en construcción (Work In Progress).
//
// Para bloquear un proyecto, añade su prefijo base a la lista.
// Todas las rutas que empiecen por ese prefijo serán redirigidas a /wip.
// Para desbloquear, simplemente elimina la entrada.
//
// Ejemplo:
//   '/projects/glasstics'   → bloquea /projects/glasstics y sub-rutas
//   '/projects/minigpt'     → bloquea /projects/minigpt, /projects/minigpt/chat, etc.

export const wipRoutePrefixes: string[] = [
  '/projects/glasstics',
  '/projects/minigpt',
];

/**
 * Comprueba si una ruta dada está marcada como WIP.
 * Funciona con y sin el prefijo de idioma (/en/).
 */
export function isWipRoute(pathname: string): boolean {
  // Normalizar: quitar trailing slash (excepto root)
  const normalized = pathname.length > 1 && pathname.endsWith('/')
    ? pathname.slice(0, -1)
    : pathname;

  // Comprobar directamente
  for (const prefix of wipRoutePrefixes) {
    if (normalized === prefix || normalized.startsWith(prefix + '/')) {
      return true;
    }
  }

  // Comprobar con prefijo de idioma (ej: /en/projects/glasstics)
  // Detectar si la ruta tiene un prefijo de idioma de 2 letras
  const langMatch = normalized.match(/^\/([a-z]{2})(\/.*)/);
  if (langMatch) {
    const routeWithoutLang = langMatch[2]; // ej: /projects/glasstics
    for (const prefix of wipRoutePrefixes) {
      if (routeWithoutLang === prefix || routeWithoutLang.startsWith(prefix + '/')) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Si la ruta actual es WIP, retorna la URL de redirección a la página WIP.
 * Preserva el idioma del usuario.
 * Retorna null si la ruta no es WIP.
 */
export function getWipRedirect(pathname: string): string | null {
  if (!isWipRoute(pathname)) return null;

  // Detectar idioma
  const langMatch = pathname.match(/^\/([a-z]{2})\//);
  const lang = langMatch ? langMatch[1] : null;

  // Para el locale por defecto (es), no hay prefijo
  if (!lang || lang === 'es') {
    return '/wip';
  }
  return `/${lang}/wip`;
}
