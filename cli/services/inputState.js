let suspended = false;

function isSuspended() {
    return suspended;
}

function suspend() {
    suspended = true;
}

function resume() {
    suspended = false;
}

module.exports = {
    isSuspended,
    suspend,
    resume
};