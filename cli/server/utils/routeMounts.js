export function isRouteMount(pathname, mountPath) {
    const normalizedPath = String(pathname || '');
    const normalizedMount = String(mountPath || '').replace(/\/+$/, '') || '/';
    return normalizedPath === normalizedMount || normalizedPath.startsWith(`${normalizedMount}/`);
}
