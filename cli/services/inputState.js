let suspended = false;
let activeInterface = null;

export function isSuspended() {
    return suspended;
}

export function suspend() {
    suspended = true;
}

export function resume() {
    suspended = false;
}

export function registerInterface(rl) {
    activeInterface = rl || null;
}

export function getInterface() {
    return activeInterface;
}
