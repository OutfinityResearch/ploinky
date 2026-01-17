import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const originalCwd = process.cwd();
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ploinky-profile-'));
process.chdir(tempDir);

const moduleSuffix = `?test=${Date.now()}`;
const profileServiceUrl = new URL('../../cli/services/profileService.js', import.meta.url);
const secretInjectorUrl = new URL('../../cli/services/secretInjector.js', import.meta.url);
const workspaceStructureUrl = new URL('../../cli/services/workspaceStructure.js', import.meta.url);

const profileService = await import(`${profileServiceUrl.href}${moduleSuffix}`);
const secretInjector = await import(`${secretInjectorUrl.href}${moduleSuffix}`);
const workspaceStructure = await import(`${workspaceStructureUrl.href}${moduleSuffix}`);

const {
    getActiveProfile,
    setActiveProfile,
    getProfileConfig,
    listProfiles,
    validateProfile,
    getDefaultMountModes,
    getProfileEnvVars
} = profileService;

const {
    loadSecretsFile,
    getSecret,
    getSecrets,
    validateSecrets,
    buildSecretEnvFlags,
    formatMissingSecretsError
} = secretInjector;

const {
    createAgentSymlinks,
    removeAgentSymlinks,
    createAgentWorkDir,
    getAgentWorkDir
} = workspaceStructure;

function writeManifest(repoName, agentName, manifest) {
    const agentDir = path.join(tempDir, '.ploinky', 'repos', repoName, agentName);
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(
        path.join(agentDir, 'manifest.json'),
        JSON.stringify(manifest, null, 4)
    );
    return agentDir;
}

test.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
});

test('getActiveProfile defaults to dev when profile file is missing', () => {
    assert.strictEqual(getActiveProfile(), 'dev');
});

test('setActiveProfile rejects invalid profile names', () => {
    const result = setActiveProfile('staging');
    assert.strictEqual(result.success, false);
    assert.match(result.message, /Invalid profile/);
});

test('setActiveProfile writes profile file and getActiveProfile reads it', () => {
    const result = setActiveProfile('qa');
    assert.strictEqual(result.success, true);
    assert.strictEqual(getActiveProfile(), 'qa');

    const profilePath = path.join(tempDir, '.ploinky', 'profile');
    assert.strictEqual(fs.readFileSync(profilePath, 'utf8').trim(), 'qa');
});

test('listProfiles returns manifest profiles and defaultProfile', () => {
    writeManifest('repo-one', 'agent-one', {
        profiles: {
            dev: {},
            qa: {}
        },
        defaultProfile: 'qa'
    });

    const result = listProfiles('repo-one/agent-one');
    assert.deepStrictEqual(result.profiles.sort(), ['dev', 'qa']);
    assert.strictEqual(result.defaultProfile, 'qa');
});

test('getProfileConfig returns the profile config when present', () => {
    writeManifest('repo-two', 'agent-two', {
        profiles: {
            dev: { env: { NODE_ENV: 'development' } }
        }
    });

    const config = getProfileConfig('repo-two/agent-two', 'dev');
    assert.deepStrictEqual(config, { env: { NODE_ENV: 'development' } });
});

test('validateProfile reports missing secrets', () => {
    writeManifest('repo-three', 'agent-three', {
        profiles: {
            dev: { secrets: ['TEST_SECRET'] }
        }
    });

    const previousValue = process.env.TEST_SECRET;
    delete process.env.TEST_SECRET;

    const result = validateProfile('repo-three/agent-three', 'dev');
    assert.strictEqual(result.valid, false);
    assert.ok(result.issues.some(issue => issue.includes('Missing required secret')));

    if (previousValue !== undefined) {
        process.env.TEST_SECRET = previousValue;
    }
});

test('validateProfile succeeds when secrets and hooks are present', () => {
    const agentDir = writeManifest('repo-four', 'agent-four', {
        profiles: {
            dev: {
                secrets: ['TEST_SECRET'],
                hosthook_aftercreation: 'scripts/hook.sh'
            }
        }
    });

    const hookPath = path.join(agentDir, 'scripts', 'hook.sh');
    fs.mkdirSync(path.dirname(hookPath), { recursive: true });
    fs.writeFileSync(hookPath, '#!/bin/sh\necho ok\n');

    const previousValue = process.env.TEST_SECRET;
    process.env.TEST_SECRET = 'present';

    const result = validateProfile('repo-four/agent-four', 'dev');
    assert.strictEqual(result.valid, true);

    if (previousValue !== undefined) {
        process.env.TEST_SECRET = previousValue;
    } else {
        delete process.env.TEST_SECRET;
    }
});

test('validateProfile accepts secrets from .env', () => {
    writeManifest('repo-five', 'agent-five', {
        profiles: {
            dev: { secrets: ['ENV_SECRET'] }
        }
    });

    const envPath = path.join(tempDir, '.env');
    fs.writeFileSync(envPath, 'ENV_SECRET=present');

    const result = validateProfile('repo-five/agent-five', 'dev');
    assert.strictEqual(result.valid, true);
});

test('getDefaultMountModes returns rw for dev and ro for prod', () => {
    assert.deepStrictEqual(getDefaultMountModes('dev'), { code: 'rw', skills: 'rw' });
    assert.deepStrictEqual(getDefaultMountModes('prod'), { code: 'ro', skills: 'ro' });
});

test('getProfileEnvVars includes profile metadata', () => {
    const envVars = getProfileEnvVars('agent-x', 'repo-x', 'qa', {
        containerName: 'container-x',
        containerId: 'container-x'
    });

    assert.strictEqual(envVars.PLOINKY_PROFILE, 'qa');
    assert.strictEqual(envVars.PLOINKY_PROFILE_ENV, 'qa');
    assert.strictEqual(envVars.PLOINKY_AGENT_NAME, 'agent-x');
    assert.strictEqual(envVars.PLOINKY_REPO_NAME, 'repo-x');
    assert.strictEqual(envVars.PLOINKY_CONTAINER_NAME, 'container-x');
    assert.strictEqual(envVars.PLOINKY_CONTAINER_ID, 'container-x');
    assert.strictEqual(envVars.PLOINKY_CWD, tempDir);
});

test('loadSecretsFile parses secrets and strips quotes', () => {
    const secretsPath = path.join(tempDir, '.ploinky', '.secrets');
    fs.mkdirSync(path.dirname(secretsPath), { recursive: true });
    fs.writeFileSync(
        secretsPath,
        [
            '# Comment',
            'PLAIN=value',
            'QUOTED="value with spaces"',
            "SINGLE='single value'"
        ].join('\n')
    );

    const secrets = loadSecretsFile();
    assert.deepStrictEqual(secrets, {
        PLAIN: 'value',
        QUOTED: 'value with spaces',
        SINGLE: 'single value'
    });
});

test('getSecret prefers environment variables over secrets file', () => {
    const secretsPath = path.join(tempDir, '.ploinky', '.secrets');
    fs.mkdirSync(path.dirname(secretsPath), { recursive: true });
    fs.writeFileSync(secretsPath, 'OVERRIDE=file-value');

    const previousValue = process.env.OVERRIDE;
    process.env.OVERRIDE = 'env-value';

    assert.strictEqual(getSecret('OVERRIDE'), 'env-value');

    if (previousValue !== undefined) {
        process.env.OVERRIDE = previousValue;
    } else {
        delete process.env.OVERRIDE;
    }
});

test('getSecret falls back to .env when other sources are missing', () => {
    const envPath = path.join(tempDir, '.env');
    fs.writeFileSync(envPath, 'ENV_ONLY=env-value');

    const previousValue = process.env.ENV_ONLY;
    delete process.env.ENV_ONLY;

    assert.strictEqual(getSecret('ENV_ONLY'), 'env-value');

    if (previousValue !== undefined) {
        process.env.ENV_ONLY = previousValue;
    }
});

test('validateSecrets uses secrets file when env missing', () => {
    const secretsPath = path.join(tempDir, '.ploinky', '.secrets');
    fs.mkdirSync(path.dirname(secretsPath), { recursive: true });
    fs.writeFileSync(secretsPath, 'FROM_FILE=yes');

    const result = validateSecrets(['FROM_FILE', 'MISSING']);
    assert.deepStrictEqual(result.missing, ['MISSING']);
    assert.strictEqual(result.source.FROM_FILE, '.secrets file');
});

test('validateSecrets records .env file as source', () => {
    const envPath = path.join(tempDir, '.env');
    fs.writeFileSync(envPath, 'FROM_ENV=yes');

    const result = validateSecrets(['FROM_ENV']);
    assert.deepStrictEqual(result.missing, []);
    assert.strictEqual(result.source.FROM_ENV, '.env file');
});

test('buildSecretEnvFlags escapes special values', () => {
    const flags = buildSecretEnvFlags({
        SIMPLE: 'value',
        COMPLEX: 'value with spaces'
    });

    assert.ok(flags.includes('-e SIMPLE=value'));
    assert.ok(flags.includes("-e COMPLEX='value with spaces'"));
});

test('formatMissingSecretsError includes guidance and file path', () => {
    const message = formatMissingSecretsError(['ONE', 'TWO'], 'qa');
    assert.ok(message.includes("Missing required secrets for profile 'qa'"));
    assert.ok(message.includes(path.join(tempDir, '.ploinky', '.secrets')));
    assert.ok(message.includes(path.join(tempDir, '.env')));
});

test('createAgentSymlinks creates code and skills symlinks', () => {
    const agentName = 'symlink-agent';
    const repoName = 'repo-symlink';
    const agentPath = path.join(tempDir, '.ploinky', 'repos', repoName, agentName);

    fs.mkdirSync(path.join(agentPath, 'code'), { recursive: true });
    fs.mkdirSync(path.join(agentPath, '.AchillesSkills'), { recursive: true });

    assert.doesNotThrow(() => createAgentSymlinks(agentName, repoName, agentPath));

    const codeLink = path.join(tempDir, 'code', agentName);
    const skillsLink = path.join(tempDir, 'skills', agentName);

    assert.ok(fs.lstatSync(codeLink).isSymbolicLink());
    assert.ok(fs.lstatSync(skillsLink).isSymbolicLink());

    const codeTarget = fs.readlinkSync(codeLink);
    const skillsTarget = fs.readlinkSync(skillsLink);

    assert.strictEqual(path.resolve(codeTarget), path.resolve(path.join(agentPath, 'code')));
    assert.strictEqual(path.resolve(skillsTarget), path.resolve(path.join(agentPath, '.AchillesSkills')));
});

test('createAgentSymlinks skips skills when folder is missing', () => {
    const agentName = 'symlink-no-skills';
    const repoName = 'repo-no-skills';
    const agentPath = path.join(tempDir, '.ploinky', 'repos', repoName, agentName);

    fs.mkdirSync(path.join(agentPath, 'code'), { recursive: true });

    createAgentSymlinks(agentName, repoName, agentPath);

    const skillsLink = path.join(tempDir, 'skills', agentName);
    assert.ok(!fs.existsSync(skillsLink));
});

test('removeAgentSymlinks removes created symlinks', () => {
    const agentName = 'symlink-remove';
    const repoName = 'repo-remove';
    const agentPath = path.join(tempDir, '.ploinky', 'repos', repoName, agentName);

    fs.mkdirSync(path.join(agentPath, 'code'), { recursive: true });
    fs.mkdirSync(path.join(agentPath, '.AchillesSkills'), { recursive: true });

    createAgentSymlinks(agentName, repoName, agentPath);
    removeAgentSymlinks(agentName);

    const codeLink = path.join(tempDir, 'code', agentName);
    const skillsLink = path.join(tempDir, 'skills', agentName);

    assert.ok(!fs.existsSync(codeLink));
    assert.ok(!fs.existsSync(skillsLink));
});

test('createAgentWorkDir creates agent workspace folder', () => {
    const agentName = 'workdir-agent';
    const workDir = createAgentWorkDir(agentName);

    assert.strictEqual(workDir, getAgentWorkDir(agentName));
    assert.ok(fs.statSync(workDir).isDirectory());
});
