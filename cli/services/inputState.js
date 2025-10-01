let suspended = false;

export function isSuspended() {
    return suspended;
}

export function suspend() {
    suspended = true;
}

export function resume() {
    suspended = false;
}
